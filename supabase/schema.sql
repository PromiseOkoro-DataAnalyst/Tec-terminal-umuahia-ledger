-- =====================================================================
--  TecTerminal Umuahia Ledger — database schema (v2, fresh project)
--
--  Run once in a NEW Supabase project:
--  Supabase → SQL Editor → New query → paste this whole file → Run.
--
--  The first person to sign up becomes admin automatically, and so do
--  the two owner emails listed in public.handle_new_user() below.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------
create type public.member_role as enum ('admin', 'marketer');
create type public.member_status as enum ('pending', 'active', 'suspended');
create type public.lead_stage as enum ('new', 'contacted', 'interested', 'visited', 'enrolled', 'lost');
create type public.interaction_kind as enum ('call', 'whatsapp', 'email', 'visit', 'note');
create type public.student_status as enum ('active', 'completed', 'withdrawn');
create type public.payment_method as enum ('transfer', 'cash', 'pos', 'other');
create type public.message_channel as enum ('email', 'whatsapp');
create type public.campaign_audience as enum ('all_leads', 'selected_leads');
create type public.membership_mode as enum ('include', 'exclude');
create type public.delivery_status as enum ('queued', 'sent', 'failed');
create type public.report_file_type as enum ('docx', 'xlsx', 'pptx');


-- ---------------------------------------------------------------------
-- 2. Core tables
-- ---------------------------------------------------------------------

-- One row per login (admins and marketers)
create table public.members (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null,
  whatsapp text,
  role public.member_role not null default 'marketer',
  status public.member_status not null default 'pending',
  signature_path text,                 -- file in the "signatures" storage bucket
  created_at timestamptz not null default now()
);

-- Course catalogue with the standard fee for each course
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  standard_fee numeric(14, 2) not null default 0 check (standard_fee >= 0),
  duration_label text,                 -- e.g. "6 months"
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  whatsapp text,
  email text,
  course_id uuid references public.courses (id) on delete set null,
  source text,                         -- walk-in, Instagram, referral...
  stage public.lead_stage not null default 'new',
  next_follow_up_on date,
  opted_out boolean not null default false,   -- stops campaign messages
  notes text,
  owner_id uuid not null default auth.uid() references public.members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Calls, WhatsApp chats, visits and notes on a lead, newest first
create table public.lead_interactions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  kind public.interaction_kind not null default 'note',
  note text not null,
  created_by uuid not null default auth.uid() references public.members (id),
  created_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid unique references public.leads (id) on delete set null,
  full_name text not null,
  whatsapp text,
  email text,
  course_id uuid not null references public.courses (id),
  agreed_fee numeric(14, 2) not null check (agreed_fee >= 0),  -- may differ from standard fee (discounts)
  enrolled_on date not null default current_date,
  status public.student_status not null default 'active',
  owner_id uuid not null default auth.uid() references public.members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every individual payment, with its own date
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  paid_on date not null default current_date,
  method public.payment_method not null default 'transfer',
  reference text,
  recorded_by uuid not null default auth.uid() references public.members (id),
  created_at timestamptz not null default now()
);

-- Commission bands, edited by admin. A marketer's whole monthly total
-- earns the rate of the band it falls into.
create table public.commission_tiers (
  id uuid primary key default gen_random_uuid(),
  lower_bound numeric(14, 2) not null check (lower_bound >= 0),
  upper_bound numeric(14, 2),          -- null = no upper limit
  rate_percent numeric(5, 2) not null check (rate_percent between 0 and 100),
  check (upper_bound is null or upper_bound > lower_bound)
);

create table public.activity_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.members (id) on delete set null,
  action text not null,                -- added, updated, deleted, exported, downloaded...
  subject_type text not null,          -- lead, student, payment, course, tiers, report...
  subject_id text,
  summary text not null,               -- human-readable line shown in the log
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 3. Tables for the next phase (campaigns, reports, broadcasts)
--    Created now so the project never needs a second migration.
-- ---------------------------------------------------------------------

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel public.message_channel not null,
  subject text,                        -- email only
  body text not null,                  -- may use {{lead_name}}, {{course}}...
  created_by uuid not null default auth.uid() references public.members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel public.message_channel not null,
  template_id uuid not null references public.message_templates (id),
  every_days integer not null check (every_days between 1 and 90),
  audience public.campaign_audience not null default 'all_leads',
  is_active boolean not null default false,
  created_by uuid not null default auth.uid() references public.members (id),
  created_at timestamptz not null default now()
);

-- Leads picked for a "selected_leads" campaign, or excluded from an "all_leads" one
create table public.campaign_memberships (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  mode public.membership_mode not null,
  primary key (campaign_id, lead_id)
);

create table public.message_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns (id) on delete set null,
  lead_id uuid references public.leads (id) on delete cascade,
  channel public.message_channel not null,
  status public.delivery_status not null default 'queued',
  error text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz
);

-- Uploaded Word/Excel/PowerPoint report designs with {{placeholders}}.
-- Admin uploads; nobody can edit or delete afterwards.
create table public.report_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  file_type public.report_file_type not null,
  file_path text not null,             -- file in the "report-templates" storage bucket
  uploaded_by uuid not null default auth.uid() references public.members (id),
  created_at timestamptz not null default now()
);

create table public.report_downloads (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.report_templates (id),
  member_id uuid not null default auth.uid() references public.members (id),
  period_label text,                   -- e.g. "Week of 26 Oct 2026"
  created_at timestamptz not null default now()
);

create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  channel public.message_channel not null,
  subject text,
  body text not null,
  media_paths text[] not null default '{}',   -- files in the "broadcast-media" bucket
  sent_at timestamptz,
  created_by uuid not null default auth.uid() references public.members (id),
  created_at timestamptz not null default now()
);

create table public.broadcast_recipients (
  broadcast_id uuid not null references public.broadcasts (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  status public.delivery_status not null default 'queued',
  error text,
  primary key (broadcast_id, lead_id)
);


-- ---------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------
create index leads_owner_index on public.leads (owner_id);
create index leads_stage_index on public.leads (stage);
create index leads_follow_up_index on public.leads (next_follow_up_on);
create index lead_interactions_lead_index on public.lead_interactions (lead_id, created_at desc);
create index students_owner_index on public.students (owner_id);
create index payments_student_index on public.payments (student_id);
create index payments_paid_on_index on public.payments (paid_on);
create index activity_log_created_index on public.activity_log (created_at desc);
create index message_log_lead_index on public.message_log (lead_id);


-- ---------------------------------------------------------------------
-- 5. Helper functions
-- ---------------------------------------------------------------------
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where public.members.id = auth.uid()
      and public.members.role = 'admin'
      and public.members.status = 'active'
  );
$$;

create function public.is_active_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where public.members.id = auth.uid()
      and public.members.status = 'active'
  );
$$;

-- Can the current user see this lead / student?
create function public.can_see_lead(target_lead_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.leads
    where public.leads.id = target_lead_id
      and public.leads.owner_id = auth.uid()
      and public.is_active_member()
  );
$$;

create function public.can_see_student(target_student_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.students
    where public.students.id = target_student_id
      and public.students.owner_id = auth.uid()
      and public.is_active_member()
  );
$$;


-- ---------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------

-- New sign-up -> member row. First ever user and the owner emails become active admins.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  becomes_admin boolean;
begin
  becomes_admin :=
    not exists (select 1 from public.members)
    or lower(new.email) in ('promiseokoro210@gmail.com', 'savvionhub@gmail.com');

  insert into public.members (id, email, full_name, whatsapp, role, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'whatsapp',
    case when becomes_admin then 'admin'::public.member_role else 'marketer'::public.member_role end,
    case when becomes_admin then 'active'::public.member_status else 'pending'::public.member_status end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Members can edit their own name, WhatsApp and signature, but not role/status/email.
create function public.guard_member_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.status := old.status;
    new.email := old.email;
  end if;
  return new;
end;
$$;

create trigger members_guard
  before update on public.members
  for each row execute function public.guard_member_changes();

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger leads_touch before update on public.leads
  for each row execute function public.touch_updated_at();
create trigger students_touch before update on public.students
  for each row execute function public.touch_updated_at();
create trigger message_templates_touch before update on public.message_templates
  for each row execute function public.touch_updated_at();

-- Report templates can never be changed or removed once uploaded
create function public.block_report_template_changes() returns trigger
language plpgsql as $$
begin
  raise exception 'Report templates cannot be edited or deleted once uploaded';
end;
$$;

create trigger report_templates_immutable
  before update or delete on public.report_templates
  for each row execute function public.block_report_template_changes();

-- Activity log: readable summary line for each change
create function public.record_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  changed_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  old_row jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  verb text := case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'updated' else 'deleted' end;
  subject text;
  line text;
begin
  if tg_table_name = 'leads' then
    subject := 'lead';
    if tg_op = 'UPDATE' and changed_row ->> 'stage' is distinct from old_row ->> 'stage' then
      line := 'moved ' || (changed_row ->> 'full_name') || ' to ' || (changed_row ->> 'stage');
    else
      line := verb || ' lead ' || (changed_row ->> 'full_name');
    end if;
  elsif tg_table_name = 'students' then
    subject := 'student';
    line := case when tg_op = 'INSERT' then 'enrolled ' else verb || ' student ' end || (changed_row ->> 'full_name');
  elsif tg_table_name = 'payments' then
    subject := 'payment';
    line := case when tg_op = 'INSERT' then 'recorded' else verb end || ' a payment of ₦' || to_char((changed_row ->> 'amount')::numeric, 'FM999,999,999,990')
      || ' for ' || coalesce((
        select public.students.full_name from public.students
        where public.students.id = (changed_row ->> 'student_id')::uuid
      ), 'a student');
  elsif tg_table_name = 'courses' then
    subject := 'course';
    line := verb || ' course ' || (changed_row ->> 'name');
  elsif tg_table_name = 'members' then
    subject := 'member';
    line := 'set ' || coalesce(nullif(changed_row ->> 'full_name', ''), changed_row ->> 'email')
      || ' to ' || (changed_row ->> 'status') || ' ' || (changed_row ->> 'role');
  else
    subject := tg_table_name;
    line := verb || ' ' || replace(tg_table_name, '_', ' ');
  end if;

  insert into public.activity_log (actor_id, action, subject_type, subject_id, summary, details)
  values (auth.uid(), verb, subject, changed_row ->> 'id', line, changed_row);
  return coalesce(new, old);
end;
$$;

create trigger leads_activity after insert or update or delete on public.leads
  for each row execute function public.record_activity();
create trigger students_activity after insert or update or delete on public.students
  for each row execute function public.record_activity();
create trigger payments_activity after insert or update or delete on public.payments
  for each row execute function public.record_activity();
create trigger courses_activity after insert or update or delete on public.courses
  for each row execute function public.record_activity();
create trigger members_activity after update on public.members
  for each row
  when (old.role is distinct from new.role or old.status is distinct from new.status)
  execute function public.record_activity();
create trigger campaigns_activity after insert or update or delete on public.campaigns
  for each row execute function public.record_activity();
create trigger report_templates_activity after insert on public.report_templates
  for each row execute function public.record_activity();


-- ---------------------------------------------------------------------
-- 7. Functions the app calls
-- ---------------------------------------------------------------------

-- Log an event the database can't see on its own (exports, report downloads, sign-ins)
create function public.log_event(event_action text, event_subject_type text, event_summary text, event_subject_id text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_member() then
    raise exception 'Only active members can log events';
  end if;
  insert into public.activity_log (actor_id, action, subject_type, subject_id, summary)
  values (auth.uid(), event_action, event_subject_type, event_subject_id, event_summary);
end;
$$;

-- Replace all commission tiers in one go (admin only). Rejects gaps that overlap.
create function public.replace_commission_tiers(new_tiers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  previous_upper numeric := null;
  tier record;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change commission tiers';
  end if;

  for tier in
    select
      (tier_json ->> 'lower_bound')::numeric as lower_bound,
      nullif(tier_json ->> 'upper_bound', '')::numeric as upper_bound
    from jsonb_array_elements(new_tiers) as tier_json
    order by (tier_json ->> 'lower_bound')::numeric
  loop
    if previous_upper is null and tier.lower_bound is null then
      raise exception 'Every tier needs a starting amount';
    end if;
    if previous_upper is not null and tier.lower_bound <= previous_upper then
      raise exception 'Tiers overlap: a tier starts at % but the one before ends at %', tier.lower_bound, previous_upper;
    end if;
    previous_upper := coalesce(tier.upper_bound, 'infinity'::numeric);
  end loop;

  delete from public.commission_tiers where true;
  insert into public.commission_tiers (lower_bound, upper_bound, rate_percent)
  select
    (tier_json ->> 'lower_bound')::numeric,
    nullif(tier_json ->> 'upper_bound', '')::numeric,
    (tier_json ->> 'rate_percent')::numeric
  from jsonb_array_elements(new_tiers) as tier_json;

  perform public.log_event('updated', 'tiers', 'updated the commission tiers');
end;
$$;

-- Turn a lead into a student in one step: student row, optional first payment, lead marked enrolled.
-- Runs with the caller's permissions, so a marketer can only enrol their own leads.
create function public.enrol_lead(
  target_lead_id uuid,
  target_course_id uuid,
  fee numeric,
  enrolment_date date default current_date,
  first_payment numeric default 0,
  first_payment_method public.payment_method default 'transfer'
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  source_lead public.leads;
  new_student_id uuid;
begin
  select * into source_lead from public.leads where public.leads.id = target_lead_id;
  if source_lead.id is null then
    raise exception 'Lead not found or not yours';
  end if;

  insert into public.students (lead_id, full_name, whatsapp, email, course_id, agreed_fee, enrolled_on, owner_id)
  values (source_lead.id, source_lead.full_name, source_lead.whatsapp, source_lead.email,
          target_course_id, fee, enrolment_date, source_lead.owner_id)
  returning public.students.id into new_student_id;

  if coalesce(first_payment, 0) > 0 then
    insert into public.payments (student_id, amount, paid_on, method)
    values (new_student_id, first_payment, enrolment_date, first_payment_method);
  end if;

  update public.leads set stage = 'enrolled' where public.leads.id = source_lead.id;
  return new_student_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 8. Views (they respect each user's row permissions)
-- ---------------------------------------------------------------------

-- One row per student with totals, balance and last payment date
create view public.student_accounts with (security_invoker = true) as
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
  count(public.payments.id) as payment_count
from public.students
join public.courses on public.courses.id = public.students.course_id
left join public.payments on public.payments.student_id = public.students.id
group by public.students.id, public.courses.name;

-- Payments collected per marketer per calendar month, and the commission earned
create view public.monthly_commission with (security_invoker = true) as
with monthly_totals as (
  select
    public.students.owner_id,
    date_trunc('month', public.payments.paid_on)::date as month_start,
    sum(public.payments.amount) as total_collected,
    count(public.payments.id) as payment_count
  from public.payments
  join public.students on public.students.id = public.payments.student_id
  group by public.students.owner_id, date_trunc('month', public.payments.paid_on)
)
select
  monthly_totals.owner_id,
  public.members.full_name as marketer_name,
  monthly_totals.month_start,
  monthly_totals.total_collected,
  monthly_totals.payment_count,
  coalesce(public.commission_tiers.rate_percent, 0) as rate_percent,
  round(monthly_totals.total_collected * coalesce(public.commission_tiers.rate_percent, 0) / 100, 2) as commission
from monthly_totals
join public.members on public.members.id = monthly_totals.owner_id
left join public.commission_tiers
  on monthly_totals.total_collected >= public.commission_tiers.lower_bound
 and (public.commission_tiers.upper_bound is null
      or monthly_totals.total_collected <= public.commission_tiers.upper_bound);


-- ---------------------------------------------------------------------
-- 9. Row Level Security
-- ---------------------------------------------------------------------
alter table public.members enable row level security;
alter table public.courses enable row level security;
alter table public.leads enable row level security;
alter table public.lead_interactions enable row level security;
alter table public.students enable row level security;
alter table public.payments enable row level security;
alter table public.commission_tiers enable row level security;
alter table public.activity_log enable row level security;
alter table public.message_templates enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_memberships enable row level security;
alter table public.message_log enable row level security;
alter table public.report_templates enable row level security;
alter table public.report_downloads enable row level security;
alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;

-- Members: see yourself; admins see and manage everyone
create policy members_read on public.members for select
  using (public.members.id = auth.uid() or public.is_admin());
create policy members_update on public.members for update
  using (public.members.id = auth.uid() or public.is_admin());

-- Courses: everyone active reads; admin manages
create policy courses_read on public.courses for select using (public.is_active_member());
create policy courses_write on public.courses for all
  using (public.is_admin()) with check (public.is_admin());

-- Leads: marketers work on their own; admins everything
create policy leads_read on public.leads for select
  using (public.is_admin() or (public.is_active_member() and public.leads.owner_id = auth.uid()));
create policy leads_insert on public.leads for insert
  with check (public.is_admin() or (public.is_active_member() and public.leads.owner_id = auth.uid()));
create policy leads_update on public.leads for update
  using (public.is_admin() or (public.is_active_member() and public.leads.owner_id = auth.uid()))
  with check (public.is_admin() or public.leads.owner_id = auth.uid());
create policy leads_delete on public.leads for delete using (public.is_admin());

create policy lead_interactions_read on public.lead_interactions for select
  using (public.can_see_lead(public.lead_interactions.lead_id));
create policy lead_interactions_insert on public.lead_interactions for insert
  with check (public.can_see_lead(public.lead_interactions.lead_id) and public.lead_interactions.created_by = auth.uid());
create policy lead_interactions_delete on public.lead_interactions for delete using (public.is_admin());

-- Students: same pattern as leads
create policy students_read on public.students for select
  using (public.is_admin() or (public.is_active_member() and public.students.owner_id = auth.uid()));
create policy students_insert on public.students for insert
  with check (public.is_admin() or (public.is_active_member() and public.students.owner_id = auth.uid()));
create policy students_update on public.students for update
  using (public.is_admin() or (public.is_active_member() and public.students.owner_id = auth.uid()))
  with check (public.is_admin() or public.students.owner_id = auth.uid());
create policy students_delete on public.students for delete using (public.is_admin());

-- Payments: record and see for your own students; only admin edits or deletes
create policy payments_read on public.payments for select
  using (public.can_see_student(public.payments.student_id));
create policy payments_insert on public.payments for insert
  with check (public.can_see_student(public.payments.student_id) and public.payments.recorded_by = auth.uid());
create policy payments_update on public.payments for update using (public.is_admin());
create policy payments_delete on public.payments for delete using (public.is_admin());

-- Commission tiers: everyone active reads; changes go through replace_commission_tiers()
create policy commission_tiers_read on public.commission_tiers for select using (public.is_active_member());

-- Activity log: admins read; rows are only written by triggers and log_event()
create policy activity_log_read on public.activity_log for select using (public.is_admin());

-- Message templates: any active member writes; you edit your own, admins edit all
create policy message_templates_read on public.message_templates for select using (public.is_active_member());
create policy message_templates_insert on public.message_templates for insert
  with check (public.is_active_member() and public.message_templates.created_by = auth.uid());
create policy message_templates_update on public.message_templates for update
  using (public.is_admin() or public.message_templates.created_by = auth.uid());
create policy message_templates_delete on public.message_templates for delete
  using (public.is_admin() or public.message_templates.created_by = auth.uid());

-- Campaigns: admin controls frequency and targeting; everyone active can view
create policy campaigns_read on public.campaigns for select using (public.is_active_member());
create policy campaigns_write on public.campaigns for all
  using (public.is_admin()) with check (public.is_admin());
create policy campaign_memberships_read on public.campaign_memberships for select using (public.is_active_member());
create policy campaign_memberships_write on public.campaign_memberships for all
  using (public.is_admin()) with check (public.is_admin());

create policy message_log_read on public.message_log for select
  using (public.is_admin() or public.can_see_lead(public.message_log.lead_id));

-- Report templates: everyone active reads; only admin uploads; nobody edits/deletes (trigger)
create policy report_templates_read on public.report_templates for select using (public.is_active_member());
create policy report_templates_insert on public.report_templates for insert
  with check (public.is_admin() and public.report_templates.uploaded_by = auth.uid());

-- Report downloads: free for any active member, always logged
create policy report_downloads_read on public.report_downloads for select
  using (public.is_admin() or public.report_downloads.member_id = auth.uid());
create policy report_downloads_insert on public.report_downloads for insert
  with check (public.is_active_member() and public.report_downloads.member_id = auth.uid());

-- Broadcasts: admin only
create policy broadcasts_admin on public.broadcasts for all
  using (public.is_admin()) with check (public.is_admin());
create policy broadcast_recipients_admin on public.broadcast_recipients for all
  using (public.is_admin()) with check (public.is_admin());

-- Signed-out visitors get nothing; signed-in users go through the policies above
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 10. File storage (signatures, report templates, broadcast media)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('signatures', 'signatures', false),
  ('report-templates', 'report-templates', false),
  ('broadcast-media', 'broadcast-media', false)
on conflict (id) do nothing;

-- Signatures: each member manages files in their own folder; admins can read all
create policy signatures_read on storage.objects for select to authenticated
  using (bucket_id = 'signatures' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy signatures_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);
create policy signatures_replace on storage.objects for update to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);
create policy signatures_remove on storage.objects for delete to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);

-- Report templates: active members download; admin uploads; no updates or deletes
create policy report_files_read on storage.objects for select to authenticated
  using (bucket_id = 'report-templates' and public.is_active_member());
create policy report_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'report-templates' and public.is_admin());

-- Broadcast media: admin only
create policy broadcast_media_admin on storage.objects for all to authenticated
  using (bucket_id = 'broadcast-media' and public.is_admin())
  with check (bucket_id = 'broadcast-media' and public.is_admin());


-- ---------------------------------------------------------------------
-- 11. Starting data (edit freely in the app afterwards)
-- ---------------------------------------------------------------------
insert into public.commission_tiers (lower_bound, upper_bound, rate_percent) values
  (0, 500000, 5),
  (500000.01, 1000000, 7),
  (1000000.01, null, 10);
