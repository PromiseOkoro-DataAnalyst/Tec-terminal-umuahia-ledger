-- =====================================================================
--  TecTerminal Umuahia Ledger — messaging (email + WhatsApp)
--
--  Run ONCE, after schema.sql:
--  Supabase → SQL Editor → New query → paste this whole file → Run.
--
--  Adds:
--   • Message templates with a purpose (lead follow-up, fee coming up,
--     fee overdue, broadcast, general) and {{placeholders}}
--   • Lead campaigns that repeat until the lead enrols or opts out
--   • Fee reminders (coming up / overdue) driven by each student's
--     "next payment due" date
--   • Broadcasts to leads and/or students, with attachments
--   • One outbox (message_log) for everything, with delivery status
--   • A daily job that queues due messages, and a 10-minute job that
--     hands them to the send-messages Edge Function (set up in README)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. New types
-- ---------------------------------------------------------------------
create type public.template_purpose as enum ('lead_follow_up', 'fee_upcoming', 'fee_overdue', 'broadcast', 'general');
create type public.message_source as enum ('campaign', 'fee_upcoming', 'fee_overdue', 'broadcast', 'manual');
create type public.whatsapp_mode as enum ('manual', 'cloud_api');


-- ---------------------------------------------------------------------
-- 2. Changes to existing tables
-- ---------------------------------------------------------------------

-- Students: when the next instalment is due, and a way to pause reminders
alter table public.students
  add column next_due_on date,
  add column next_due_amount numeric(14, 2) check (next_due_amount is null or next_due_amount > 0),
  add column opted_out boolean not null default false,
  add column opt_out_token uuid not null default gen_random_uuid();

-- Leads: secret token for the "unsubscribe" link in emails
alter table public.leads add column opt_out_token uuid not null default gen_random_uuid();
create unique index leads_opt_out_token_index on public.leads (opt_out_token);
create unique index students_opt_out_token_index on public.students (opt_out_token);
create index students_next_due_index on public.students (next_due_on);

-- Templates work for both channels: email uses subject + body, WhatsApp uses body
alter table public.message_templates
  add column purpose public.template_purpose not null default 'general',
  alter column channel drop not null,
  alter column created_by drop not null;

-- Campaigns: send on email, WhatsApp or both; choose which lead stages get it
alter table public.campaigns
  add column channels public.message_channel[] not null default '{whatsapp}',
  add column lead_stages public.lead_stage[] not null default '{new,contacted,interested,visited}',
  add column description text,
  add column last_run_at timestamptz,
  alter column channel drop not null;

-- Broadcasts: leads, students or both; several channels
alter table public.broadcasts
  add column title text not null default 'Broadcast',
  add column channels public.message_channel[] not null default '{whatsapp}',
  add column audience_summary text,
  add column recipient_count integer not null default 0,
  alter column channel drop not null;
drop table if exists public.broadcast_recipients;   -- replaced by message_log rows

-- Outbox: one row per message to one person on one channel
alter table public.message_log
  add column source public.message_source not null default 'campaign',
  add column student_id uuid references public.students (id) on delete cascade,
  add column broadcast_id uuid references public.broadcasts (id) on delete cascade,
  add column template_id uuid references public.message_templates (id) on delete set null,
  add column recipient_name text,
  add column to_address text,
  add column subject text,
  add column body text,
  add column media_paths text[] not null default '{}',
  add column due_ref date,                 -- which due date a fee reminder was about
  add column attempts integer not null default 0,
  add column provider_message_id text,
  add column created_by uuid references public.members (id) on delete set null;

create index message_log_status_index on public.message_log (status, queued_at);
create index message_log_student_index on public.message_log (student_id);
create index message_log_campaign_index on public.message_log (campaign_id, lead_id, channel, queued_at desc);


-- Student list also shows the next due date (new columns go at the end)
create or replace view public.student_accounts with (security_invoker = true) as
select
  public.students.id as student_id,
  public.students.full_name,
  public.students.whatsapp,
  public.students.email,
  public.students.status,
  public.students.enrolled_on,
  public.students.owner_id,
  public.students.course_id,
  public.courses.name as course_name,
  public.students.agreed_fee,
  coalesce(sum(public.payments.amount), 0) as total_paid,
  public.students.agreed_fee - coalesce(sum(public.payments.amount), 0) as balance,
  max(public.payments.paid_on) as last_paid_on,
  count(public.payments.id) as payment_count,
  public.students.next_due_on,
  public.students.next_due_amount,
  public.students.opted_out
from public.students
join public.courses on public.courses.id = public.students.course_id
left join public.payments on public.payments.student_id = public.students.id
group by public.students.id, public.courses.name;


-- ---------------------------------------------------------------------
-- 3. New tables
-- ---------------------------------------------------------------------

-- Fee reminders: one row each for "coming up" and "overdue"
create table public.fee_reminders (
  kind public.message_source primary key check (kind in ('fee_upcoming', 'fee_overdue')),
  is_active boolean not null default false,
  template_id uuid references public.message_templates (id) on delete set null,
  channels public.message_channel[] not null default '{whatsapp}',
  days_before integer not null default 3 check (days_before between 0 and 30),       -- coming up: how many days before the due date
  repeat_every_days integer not null default 7 check (repeat_every_days between 1 and 60), -- overdue: how often to repeat
  max_reminders integer not null default 4 check (max_reminders between 1 and 20),     -- overdue: stop after this many per due date
  last_run_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Sending settings (one row)
create table public.messaging_settings (
  id boolean primary key default true check (id),
  sender_name text not null default 'TecTerminal Umuahia',
  reply_to_email text,
  site_url text,                          -- your Vercel address, for unsubscribe links
  whatsapp_mode public.whatsapp_mode not null default 'manual',
  whatsapp_template_name text,            -- approved Meta template with one {{1}} body variable
  whatsapp_template_language text not null default 'en',
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.messaging_settings (id) values (true);


-- ---------------------------------------------------------------------
-- 4. Filling in {{placeholders}}
-- ---------------------------------------------------------------------

-- Replaces {{key}} with values from a JSON object. Unknown keys become blank.
create function public.fill_placeholders(template_text text, vars jsonb) returns text
language plpgsql immutable as $$
declare
  result text := coalesce(template_text, '');
  pair record;
begin
  for pair in select key, value from jsonb_each_text(vars) loop
    result := replace(result, '{{' || pair.key || '}}', coalesce(pair.value, ''));
  end loop;
  return regexp_replace(result, '\{\{\s*[a-z_]+\s*\}\}', '', 'g');
end;
$$;

-- Everything a template can use about a lead
create function public.lead_vars(target_lead_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'first_name', split_part(trim(public.leads.full_name), ' ', 1),
    'full_name', public.leads.full_name,
    'course', coalesce(public.courses.name, 'our courses'),
    'course_fee', case when public.courses.standard_fee is null then ''
                       else '₦' || to_char(public.courses.standard_fee, 'FM999,999,999,990') end,
    'marketer_name', coalesce(nullif(public.members.full_name, ''), 'TecTerminal Umuahia'),
    'marketer_whatsapp', coalesce(public.members.whatsapp, ''),
    'opt_out_link', coalesce(
      (select rtrim(public.messaging_settings.site_url, '/') || '/unsubscribe?t=' || public.leads.opt_out_token
       from public.messaging_settings where public.messaging_settings.site_url is not null), '')
  )
  from public.leads
  left join public.courses on public.courses.id = public.leads.course_id
  left join public.members on public.members.id = public.leads.owner_id
  where public.leads.id = target_lead_id;
$$;

-- Everything a template can use about a student
create function public.student_vars(target_student_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'first_name', split_part(trim(public.students.full_name), ' ', 1),
    'full_name', public.students.full_name,
    'course', public.courses.name,
    'course_fee', '₦' || to_char(public.students.agreed_fee, 'FM999,999,999,990'),
    'amount_paid', '₦' || to_char(coalesce(paid.total, 0), 'FM999,999,999,990'),
    'balance', '₦' || to_char(greatest(public.students.agreed_fee - coalesce(paid.total, 0), 0), 'FM999,999,999,990'),
    'amount_due', '₦' || to_char(coalesce(public.students.next_due_amount,
                     greatest(public.students.agreed_fee - coalesce(paid.total, 0), 0)), 'FM999,999,999,990'),
    'due_date', coalesce(to_char(public.students.next_due_on, 'FMDD Mon YYYY'), ''),
    'days_overdue', coalesce(greatest(current_date - public.students.next_due_on, 0)::text, ''),
    'marketer_name', coalesce(nullif(public.members.full_name, ''), 'TecTerminal Umuahia'),
    'marketer_whatsapp', coalesce(public.members.whatsapp, ''),
    'opt_out_link', coalesce(
      (select rtrim(public.messaging_settings.site_url, '/') || '/unsubscribe?t=' || public.students.opt_out_token
       from public.messaging_settings where public.messaging_settings.site_url is not null), '')
  )
  from public.students
  join public.courses on public.courses.id = public.students.course_id
  left join public.members on public.members.id = public.students.owner_id
  left join lateral (
    select sum(public.payments.amount) as total from public.payments
    where public.payments.student_id = public.students.id
  ) paid on true
  where public.students.id = target_student_id;
$$;

-- Preview a template for one lead or student (the app shows this before sending)
create function public.preview_message(target_template_id uuid, target_lead_id uuid default null, target_student_id uuid default null)
returns table (subject text, body text)
language plpgsql stable security definer set search_path = public as $$
declare
  vars jsonb;
begin
  if target_lead_id is not null and not public.can_see_lead(target_lead_id) then
    raise exception 'You cannot message this lead';
  end if;
  if target_student_id is not null and not public.can_see_student(target_student_id) then
    raise exception 'You cannot message this student';
  end if;
  vars := case
    when target_student_id is not null then public.student_vars(target_student_id)
    when target_lead_id is not null then public.lead_vars(target_lead_id)
    else '{}'::jsonb end;
  return query
    select public.fill_placeholders(public.message_templates.subject, vars),
           public.fill_placeholders(public.message_templates.body, vars)
    from public.message_templates where public.message_templates.id = target_template_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. Queueing messages
-- ---------------------------------------------------------------------

-- Nigerian numbers to international digits: 0803… → 234803…
create function public.whatsapp_digits(raw text) returns text
language sql immutable as $$
  select case
    when raw is null or regexp_replace(raw, '\D', '', 'g') = '' then null
    when regexp_replace(raw, '\D', '', 'g') like '0%' then '234' || substr(regexp_replace(raw, '\D', '', 'g'), 2)
    else regexp_replace(raw, '\D', '', 'g') end;
$$;

-- Send one message now from a lead or student drawer.
-- Email is queued for the sender; WhatsApp in manual mode is logged as sent
-- (the app opens WhatsApp on the phone with the text filled in).
create function public.send_one_message(
  target_template_id uuid,
  target_channel public.message_channel,
  target_lead_id uuid default null,
  target_student_id uuid default null,
  custom_subject text default null,
  custom_body text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  preview record;
  person_name text;
  address text;
  manual_whatsapp boolean;
  new_id uuid;
begin
  if not public.is_active_member() then raise exception 'Not allowed'; end if;
  select * into preview from public.preview_message(target_template_id, target_lead_id, target_student_id);

  if target_student_id is not null then
    select public.students.full_name,
           case when target_channel = 'email' then public.students.email else public.whatsapp_digits(public.students.whatsapp) end
      into person_name, address
      from public.students where public.students.id = target_student_id;
  else
    select public.leads.full_name,
           case when target_channel = 'email' then public.leads.email else public.whatsapp_digits(public.leads.whatsapp) end
      into person_name, address
      from public.leads where public.leads.id = target_lead_id;
  end if;
  if address is null or address = '' then
    raise exception 'No % on record for %', case when target_channel = 'email' then 'email address' else 'WhatsApp number' end, person_name;
  end if;

  select public.messaging_settings.whatsapp_mode = 'manual' into manual_whatsapp from public.messaging_settings;
  manual_whatsapp := target_channel = 'whatsapp' and coalesce(manual_whatsapp, true);

  insert into public.message_log (source, lead_id, student_id, template_id, channel, recipient_name, to_address,
                                  subject, body, status, sent_at, created_by)
  values ('manual', target_lead_id, target_student_id, target_template_id, target_channel, person_name, address,
          coalesce(nullif(custom_subject, ''), preview.subject), coalesce(nullif(custom_body, ''), preview.body),
          case when manual_whatsapp then 'sent'::public.delivery_status else 'queued'::public.delivery_status end,
          case when manual_whatsapp then now() end, auth.uid())
  returning public.message_log.id into new_id;

  if target_lead_id is not null then
    insert into public.lead_interactions (lead_id, kind, note, created_by)
    values (target_lead_id, case when target_channel = 'email' then 'email'::public.interaction_kind else 'whatsapp'::public.interaction_kind end,
            'Sent: ' || left(coalesce(nullif(custom_body, ''), preview.body), 280), auth.uid());
  end if;
  return new_id;
end;
$$;

-- Marketers send queued WhatsApp messages by hand (manual mode), then tick them off
create function public.mark_message_sent(target_message_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.message_log
     set status = 'sent', sent_at = now(), error = null
   where public.message_log.id = target_message_id
     and public.message_log.status <> 'sent'
     and (public.is_admin()
          or (public.message_log.lead_id is not null and public.can_see_lead(public.message_log.lead_id))
          or (public.message_log.student_id is not null and public.can_see_student(public.message_log.student_id)));
end;
$$;

-- Admin: drop a queued message, or retry a failed one
create function public.set_message_status(target_message_id uuid, new_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can do this'; end if;
  if new_status = 'retry' then
    update public.message_log set status = 'queued', error = null where public.message_log.id = target_message_id;
  elsif new_status = 'cancel' then
    update public.message_log set status = 'failed', error = 'Cancelled by admin'
     where public.message_log.id = target_message_id and public.message_log.status = 'queued';
  end if;
end;
$$;

-- Queue a broadcast for the leads and students picked in the app (admin only)
create function public.queue_broadcast(target_broadcast_id uuid, lead_ids uuid[], student_ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  cast_row public.broadcasts;
  channel_name public.message_channel;
  queued integer := 0;
  added integer;
begin
  if not public.is_admin() then raise exception 'Only admins can send broadcasts'; end if;
  select * into cast_row from public.broadcasts where public.broadcasts.id = target_broadcast_id;
  if cast_row.sent_at is not null then raise exception 'This broadcast has already been sent'; end if;

  foreach channel_name in array cast_row.channels loop
    insert into public.message_log (source, broadcast_id, lead_id, channel, recipient_name, to_address, subject, body, media_paths, created_by)
    select 'broadcast', cast_row.id, public.leads.id, channel_name, public.leads.full_name,
           case when channel_name = 'email' then public.leads.email else public.whatsapp_digits(public.leads.whatsapp) end,
           public.fill_placeholders(cast_row.subject, public.lead_vars(public.leads.id)),
           public.fill_placeholders(cast_row.body, public.lead_vars(public.leads.id)),
           cast_row.media_paths, auth.uid()
    from public.leads
    where public.leads.id = any(coalesce(lead_ids, '{}'))
      and not public.leads.opted_out
      and nullif(case when channel_name = 'email' then public.leads.email else public.leads.whatsapp end, '') is not null;
    get diagnostics added = row_count;
    queued := queued + added;

    insert into public.message_log (source, broadcast_id, student_id, channel, recipient_name, to_address, subject, body, media_paths, created_by)
    select 'broadcast', cast_row.id, public.students.id, channel_name, public.students.full_name,
           case when channel_name = 'email' then public.students.email else public.whatsapp_digits(public.students.whatsapp) end,
           public.fill_placeholders(cast_row.subject, public.student_vars(public.students.id)),
           public.fill_placeholders(cast_row.body, public.student_vars(public.students.id)),
           cast_row.media_paths, auth.uid()
    from public.students
    where public.students.id = any(coalesce(student_ids, '{}'))
      and not public.students.opted_out
      and nullif(case when channel_name = 'email' then public.students.email else public.students.whatsapp end, '') is not null;
    get diagnostics added = row_count;
    queued := queued + added;
  end loop;

  update public.broadcasts set sent_at = now(), recipient_count = queued where public.broadcasts.id = cast_row.id;
  perform public.log_event('sent', 'broadcast', 'sent broadcast "' || cast_row.title || '" to ' || queued || ' recipient' || case when queued = 1 then '' else 's' end, cast_row.id::text);
  return queued;
end;
$$;

-- The daily job: queue campaign messages and fee reminders that are due.
-- Safe to run more than once a day; nothing is queued twice.
create function public.queue_due_messages() returns integer
language plpgsql security definer set search_path = public as $$
declare
  campaign_row public.campaigns;
  template_row public.message_templates;
  reminder public.fee_reminders;
  channel_name public.message_channel;
  queued integer := 0;
  added integer;
begin
  -- Messages still waiting for someone who has since enrolled or opted out: cancel them
  update public.message_log set status = 'failed', error = 'Skipped: lead enrolled or opted out'
  from public.leads
  where public.message_log.lead_id = public.leads.id
    and public.message_log.status = 'queued'
    and public.message_log.source = 'campaign'
    and (public.leads.stage in ('enrolled', 'lost') or public.leads.opted_out);

  update public.message_log set status = 'failed', error = 'Skipped: balance cleared or reminders paused'
  from public.student_accounts
  where public.message_log.student_id = public.student_accounts.student_id
    and public.message_log.status = 'queued'
    and public.message_log.source in ('fee_upcoming', 'fee_overdue')
    and (public.student_accounts.balance <= 0
         or exists (select 1 from public.students where public.students.id = public.student_accounts.student_id and public.students.opted_out));

  -- Lead campaigns: repeat every N days until the lead enrols, is lost, or opts out
  for campaign_row in select * from public.campaigns where public.campaigns.is_active loop
    select * into template_row from public.message_templates where public.message_templates.id = campaign_row.template_id;
    continue when template_row.id is null;

    foreach channel_name in array campaign_row.channels loop
      insert into public.message_log (source, campaign_id, lead_id, template_id, channel, recipient_name, to_address, subject, body)
      select 'campaign', campaign_row.id, public.leads.id, template_row.id, channel_name, public.leads.full_name,
             case when channel_name = 'email' then public.leads.email else public.whatsapp_digits(public.leads.whatsapp) end,
             public.fill_placeholders(template_row.subject, public.lead_vars(public.leads.id)),
             public.fill_placeholders(template_row.body, public.lead_vars(public.leads.id))
      from public.leads
      where public.leads.stage = any(campaign_row.lead_stages)
        and public.leads.stage not in ('enrolled', 'lost')
        and not public.leads.opted_out
        and nullif(case when channel_name = 'email' then public.leads.email else public.leads.whatsapp end, '') is not null
        and (
          (campaign_row.audience = 'all_leads' and not exists (
             select 1 from public.campaign_memberships
             where public.campaign_memberships.campaign_id = campaign_row.id
               and public.campaign_memberships.lead_id = public.leads.id
               and public.campaign_memberships.mode = 'exclude'))
          or
          (campaign_row.audience = 'selected_leads' and exists (
             select 1 from public.campaign_memberships
             where public.campaign_memberships.campaign_id = campaign_row.id
               and public.campaign_memberships.lead_id = public.leads.id
               and public.campaign_memberships.mode = 'include'))
        )
        -- last message from this campaign on this channel was long enough ago (2 h slack so a daily run never drifts)
        and not exists (
          select 1 from public.message_log
          where public.message_log.campaign_id = campaign_row.id
            and public.message_log.lead_id = public.leads.id
            and public.message_log.channel = channel_name
            and public.message_log.status <> 'failed'
            and public.message_log.queued_at > now() - make_interval(days => campaign_row.every_days) + interval '2 hours'
        );
      get diagnostics added = row_count;
      queued := queued + added;
    end loop;
    update public.campaigns set last_run_at = now() where public.campaigns.id = campaign_row.id;
  end loop;

  -- Fee coming up: once per due date, N days before
  select * into reminder from public.fee_reminders where public.fee_reminders.kind = 'fee_upcoming';
  if reminder.is_active and reminder.template_id is not null then
    select * into template_row from public.message_templates where public.message_templates.id = reminder.template_id;
    foreach channel_name in array reminder.channels loop
      insert into public.message_log (source, student_id, template_id, channel, recipient_name, to_address, subject, body, due_ref)
      select 'fee_upcoming', public.students.id, template_row.id, channel_name, public.students.full_name,
             case when channel_name = 'email' then public.students.email else public.whatsapp_digits(public.students.whatsapp) end,
             public.fill_placeholders(template_row.subject, public.student_vars(public.students.id)),
             public.fill_placeholders(template_row.body, public.student_vars(public.students.id)),
             public.students.next_due_on
      from public.students
      join public.student_accounts on public.student_accounts.student_id = public.students.id
      where public.students.status = 'active'
        and not public.students.opted_out
        and public.student_accounts.balance > 0
        and public.students.next_due_on between current_date and current_date + reminder.days_before
        and nullif(case when channel_name = 'email' then public.students.email else public.students.whatsapp end, '') is not null
        and not exists (
          select 1 from public.message_log
          where public.message_log.student_id = public.students.id
            and public.message_log.source = 'fee_upcoming'
            and public.message_log.channel = channel_name
            and public.message_log.due_ref = public.students.next_due_on
            and public.message_log.status <> 'failed');
      get diagnostics added = row_count;
      queued := queued + added;
    end loop;
    update public.fee_reminders set last_run_at = now() where public.fee_reminders.kind = 'fee_upcoming';
  end if;

  -- Fee overdue: repeat every N days, up to a limit, until paid or the due date moves
  select * into reminder from public.fee_reminders where public.fee_reminders.kind = 'fee_overdue';
  if reminder.is_active and reminder.template_id is not null then
    select * into template_row from public.message_templates where public.message_templates.id = reminder.template_id;
    foreach channel_name in array reminder.channels loop
      insert into public.message_log (source, student_id, template_id, channel, recipient_name, to_address, subject, body, due_ref)
      select 'fee_overdue', public.students.id, template_row.id, channel_name, public.students.full_name,
             case when channel_name = 'email' then public.students.email else public.whatsapp_digits(public.students.whatsapp) end,
             public.fill_placeholders(template_row.subject, public.student_vars(public.students.id)),
             public.fill_placeholders(template_row.body, public.student_vars(public.students.id)),
             public.students.next_due_on
      from public.students
      join public.student_accounts on public.student_accounts.student_id = public.students.id
      where public.students.status = 'active'
        and not public.students.opted_out
        and public.student_accounts.balance > 0
        and public.students.next_due_on < current_date
        and nullif(case when channel_name = 'email' then public.students.email else public.students.whatsapp end, '') is not null
        and (select count(*) from public.message_log
             where public.message_log.student_id = public.students.id
               and public.message_log.source = 'fee_overdue'
               and public.message_log.channel = channel_name
               and public.message_log.due_ref = public.students.next_due_on
               and public.message_log.status <> 'failed') < reminder.max_reminders
        and not exists (
          select 1 from public.message_log
          where public.message_log.student_id = public.students.id
            and public.message_log.source = 'fee_overdue'
            and public.message_log.channel = channel_name
            and public.message_log.due_ref = public.students.next_due_on
            and public.message_log.status <> 'failed'
            and public.message_log.queued_at > now() - make_interval(days => reminder.repeat_every_days) + interval '2 hours');
      get diagnostics added = row_count;
      queued := queued + added;
    end loop;
    update public.fee_reminders set last_run_at = now() where public.fee_reminders.kind = 'fee_overdue';
  end if;

  return queued;
end;
$$;

-- Admin "Run now" button: same as the daily job
create function public.run_automations_now() returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can do this'; end if;
  return public.queue_due_messages();
end;
$$;

-- Unsubscribe link (works without signing in). Returns the person's first name.
create function public.opt_out(token uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  person text;
begin
  update public.leads set opted_out = true where public.leads.opt_out_token = token
  returning split_part(public.leads.full_name, ' ', 1) into person;
  if person is null then
    update public.students set opted_out = true where public.students.opt_out_token = token
    returning split_part(public.students.full_name, ' ', 1) into person;
  end if;
  if person is not null then
    insert into public.activity_log (action, subject_type, summary)
    values ('opted out', 'message', person || ' unsubscribed from messages');
  end if;
  return person;
end;
$$;


-- ---------------------------------------------------------------------
-- 6. Activity log for the new things
-- ---------------------------------------------------------------------
create function public.record_messaging_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  changed_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  verb text := case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'updated' else 'deleted' end;
  subject text := case tg_table_name when 'campaigns' then 'campaign' when 'message_templates' then 'template' else 'broadcast' end;
  line text;
begin
  if tg_table_name = 'campaigns' and tg_op = 'UPDATE'
     and (to_jsonb(old) ->> 'is_active') is distinct from (changed_row ->> 'is_active') then
    line := case when (changed_row ->> 'is_active')::boolean then 'started' else 'paused' end || ' campaign ' || (changed_row ->> 'name');
  elsif tg_table_name = 'broadcasts' then
    line := 'drafted broadcast "' || (changed_row ->> 'title') || '"';
  else
    line := verb || ' ' || subject || ' ' || coalesce(changed_row ->> 'name', '');
  end if;
  insert into public.activity_log (actor_id, action, subject_type, subject_id, summary)
  values (auth.uid(), verb, subject, changed_row ->> 'id', line);
  return coalesce(new, old);
end;
$$;

-- Campaigns: log real edits only (not the daily job stamping last_run_at)
drop trigger if exists campaigns_activity on public.campaigns;
create trigger campaigns_activity
  after insert or delete or update of name, template_id, every_days, audience, is_active, channels, lead_stages
  on public.campaigns for each row execute function public.record_messaging_activity();
create trigger message_templates_activity after insert or delete or update of name, subject, body
  on public.message_templates for each row execute function public.record_messaging_activity();
create trigger broadcasts_activity after insert on public.broadcasts
  for each row execute function public.record_messaging_activity();


-- ---------------------------------------------------------------------
-- 7. Permissions
-- ---------------------------------------------------------------------
alter table public.fee_reminders enable row level security;
alter table public.messaging_settings enable row level security;

create policy fee_reminders_read on public.fee_reminders for select using (public.is_active_member());
create policy fee_reminders_write on public.fee_reminders for update using (public.is_admin()) with check (public.is_admin());
create policy messaging_settings_read on public.messaging_settings for select using (public.is_active_member());
create policy messaging_settings_write on public.messaging_settings for update using (public.is_admin()) with check (public.is_admin());

-- Outbox: you see messages to your own leads and students; admins see all
drop policy if exists message_log_read on public.message_log;
create policy message_log_read on public.message_log for select
  using (public.is_admin()
         or (public.message_log.lead_id is not null and public.can_see_lead(public.message_log.lead_id))
         or (public.message_log.student_id is not null and public.can_see_student(public.message_log.student_id)));

-- Broadcast attachments are public links (flyers, videos) so they open in WhatsApp
update storage.buckets set public = true where id = 'broadcast-media';

revoke all on public.fee_reminders, public.messaging_settings from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
grant execute on function public.opt_out(uuid) to anon;
-- The daily job runs as the database itself; nobody calls it from the browser
revoke execute on function public.queue_due_messages() from authenticated;
-- These read any lead or student, so only the database's own functions may call them
revoke execute on function public.lead_vars(uuid), public.student_vars(uuid) from authenticated;


-- ---------------------------------------------------------------------
-- 8. Starter templates and reminder settings (edit in the app)
-- ---------------------------------------------------------------------
with starter as (
  insert into public.message_templates (name, purpose, subject, body) values
  ('Lead follow-up — friendly nudge', 'lead_follow_up',
   '{{first_name}}, your seat for {{course}} is waiting',
   E'Hello {{first_name}},\n\nThank you for your interest in {{course}} at TecTerminal Umuahia. Classes are filling up and we would love to have you.\n\nReply to this message or call {{marketer_name}} on {{marketer_whatsapp}} to book a visit or start your registration.\n\nTecTerminal — Learn. Connect. Succeed.'),
  ('Fee coming up', 'fee_upcoming',
   'Your next payment for {{course}} is due {{due_date}}',
   E'Hello {{first_name}},\n\nThis is a friendly reminder that your next payment of {{amount_due}} for {{course}} is due on {{due_date}}.\n\nYour current balance is {{balance}}. You can pay by transfer or at the centre.\n\nThank you,\n{{marketer_name}}, TecTerminal Umuahia'),
  ('Fee overdue', 'fee_overdue',
   'Payment for {{course}} is now overdue',
   E'Hello {{first_name}},\n\nYour payment of {{amount_due}} for {{course}} was due on {{due_date}} ({{days_overdue}} days ago). Your outstanding balance is {{balance}}.\n\nPlease make the payment or speak with {{marketer_name}} on {{marketer_whatsapp}} so your classes continue without interruption.\n\nTecTerminal Umuahia'),
  ('New class starting', 'broadcast',
   'New {{course}} class starts soon at TecTerminal Umuahia',
   E'Hello {{first_name}},\n\nA new class is starting soon at TecTerminal Umuahia. Spaces are limited.\n\nReply to this message to reserve your seat.\n\nTecTerminal — Learn. Connect. Succeed.')
  returning id, purpose
)
insert into public.fee_reminders (kind, template_id, days_before, repeat_every_days, max_reminders)
select 'fee_upcoming'::public.message_source, (select id from starter where purpose = 'fee_upcoming'), 3, 7, 1
union all
select 'fee_overdue'::public.message_source, (select id from starter where purpose = 'fee_overdue'), 3, 7, 4;


-- ---------------------------------------------------------------------
-- 9. Schedule (needs the pg_cron extension — free on every Supabase plan)
--    Queues due messages every morning at 9:00 Lagos time (08:00 UTC).
--    The job that SENDS them is added in the README, step "Turn on sending".
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('queue-due-messages', '0 8 * * *', $$select public.queue_due_messages()$$);
