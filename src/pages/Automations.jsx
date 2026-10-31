import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { useAuth } from '../context/auth'
import { useToast } from '../components/toast'
import { STAGES, stageLabel, timeAgo } from '../lib/format'
import { CHANNELS, callSender, fillSample, purposeLabel } from '../lib/messaging'
import Icon from '../components/Icon'
import { ErrorNote, Field, Loading, Modal, PageHead, Search, Segmented } from '../components/ui'

const OPEN_STAGES = STAGES.filter((stage) => !['enrolled', 'lost'].includes(stage.key))

export default function Automations() {
  const toast = useToast()
  const [editing, setEditing] = useState(null)
  const [running, setRunning] = useState(false)

  const { data, error, reload } = useLoad(async () => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const [campaigns, templates, reminders, settings, recent, memberships] = await Promise.all([
      must(supabase.from('campaigns').select('*').order('created_at')),
      must(supabase.from('message_templates').select('id, name, purpose, body').order('name')),
      must(supabase.from('fee_reminders').select('*')),
      must(supabase.from('messaging_settings').select('*').single()),
      must(supabase.from('message_log').select('campaign_id, source, status').gte('queued_at', since).neq('source', 'manual')),
      must(supabase.from('campaign_memberships').select('campaign_id, lead_id, mode')),
    ])
    const stat = (match) => {
      const rows = recent.filter(match)
      return { sent: rows.filter((row) => row.status === 'sent').length, waiting: rows.filter((row) => row.status === 'queued').length }
    }
    return {
      campaigns: campaigns.map((campaign) => ({
        ...campaign,
        stats: stat((row) => row.campaign_id === campaign.id),
        members: memberships.filter((row) => row.campaign_id === campaign.id),
      })),
      templates,
      reminders: Object.fromEntries(reminders.map((reminder) => [reminder.kind, { ...reminder, stats: stat((row) => row.source === reminder.kind) }])),
      settings,
    }
  }, [])

  const toggleCampaign = async (campaign) => {
    const { error: saveError } = await supabase.from('campaigns').update({ is_active: !campaign.is_active }).eq('id', campaign.id)
    if (saveError) return toast(saveError.message, 'error')
    toast(campaign.is_active ? `${campaign.name} paused` : `${campaign.name} is running — first messages go out at the next 9:00 run`)
    reload()
  }

  const removeCampaign = async (campaign) => {
    if (!window.confirm(`Delete the campaign “${campaign.name}”? Messages already sent stay in the Outbox.`)) return
    const { error: deleteError } = await supabase.from('campaigns').delete().eq('id', campaign.id)
    if (deleteError) return toast(deleteError.message, 'error')
    toast('Campaign deleted')
    reload()
  }

  const runNow = async () => {
    setRunning(true)
    const { data: queued, error: runError } = await supabase.rpc('run_automations_now')
    setRunning(false)
    if (runError) return toast(runError.message, 'error')
    toast(queued ? `${queued} message${queued === 1 ? '' : 's'} queued — see the Outbox` : 'Nothing is due right now')
    reload()
  }

  return (
    <>
      <PageHead title="Automations" sub="Messages that send themselves: lead follow-ups until they enrol, and fee reminders until students pay.">
        <button className="btn btn-primary" onClick={runNow} disabled={running}><Icon name="play" size={18} /> {running ? 'Checking…' : 'Run now'}</button>
      </PageHead>
      <ErrorNote>{error}</ErrorNote>
      {!data ? <Loading rows={6} /> : (
        <>
          <section className="auto-section">
            <div className="section-title">
              <h2>Fee reminders</h2>
              <p className="muted">Uses each student’s <b>next payment due</b> date (set it in the student’s record). Stops once the balance is cleared.</p>
            </div>
            <div className="split">
              <ReminderCard key={`u-${data.reminders.fee_upcoming.updated_at}`} kind="fee_upcoming" reminder={data.reminders.fee_upcoming} templates={data.templates} onSaved={reload} />
              <ReminderCard key={`o-${data.reminders.fee_overdue.updated_at}`} kind="fee_overdue" reminder={data.reminders.fee_overdue} templates={data.templates} onSaved={reload} />
            </div>
          </section>

          <section className="auto-section">
            <div className="section-title row spread">
              <div>
                <h2>Lead campaigns</h2>
                <p className="muted">Each campaign repeats on its schedule until a lead enrols, is marked lost, or opts out.</p>
              </div>
              <button className="btn" onClick={() => setEditing({})}><Icon name="plus" size={18} /> New campaign</button>
            </div>
            {data.campaigns.length === 0 ? (
              <div className="panel empty-inline">
                <Icon name="repeat" size={22} />
                <span>No campaigns yet. Create one to follow up with leads automatically.</span>
                <button className="btn btn-primary btn-small" onClick={() => setEditing({})}>Create a campaign</button>
              </div>
            ) : (
              <div className="campaign-grid">
                {data.campaigns.map((campaign) => {
                  const template = data.templates.find((item) => item.id === campaign.template_id)
                  const picked = campaign.members.filter((row) => row.mode === (campaign.audience === 'all_leads' ? 'exclude' : 'include')).length
                  return (
                    <article key={campaign.id} className={`panel campaign-card tilt ${campaign.is_active ? 'is-live' : ''}`}>
                      <header className="row spread">
                        <span className={`live-pill ${campaign.is_active ? 'on' : ''}`}><i />{campaign.is_active ? 'Running' : 'Paused'}</span>
                        <button className={`switch ${campaign.is_active ? 'on' : ''}`} role="switch" aria-checked={campaign.is_active}
                          aria-label={campaign.is_active ? 'Pause campaign' : 'Start campaign'} onClick={() => toggleCampaign(campaign)}><span /></button>
                      </header>
                      <h3>{campaign.name}</h3>
                      {campaign.description && <p className="muted small">{campaign.description}</p>}
                      <dl className="facts">
                        <div><dt>Every</dt><dd>{campaign.every_days} day{campaign.every_days === 1 ? '' : 's'}</dd></div>
                        <div><dt>By</dt><dd className="row">{campaign.channels.map((item) => <Icon key={item} name={item === 'email' ? 'mail' : 'whatsapp'} size={16} />)}</dd></div>
                        <div className="facts-wide"><dt>Who</dt><dd>
                          {campaign.audience === 'all_leads' ? 'All leads' : `${picked} chosen lead${picked === 1 ? '' : 's'}`} in {campaign.lead_stages.map(stageLabel).join(', ')}
                          {campaign.audience === 'all_leads' && picked > 0 ? ` (${picked} left out)` : ''}
                        </dd></div>
                        <div className="facts-wide"><dt>Template</dt><dd>{template?.name || 'Missing — pick one'}</dd></div>
                      </dl>
                      <div className="campaign-stats">
                        <span><b>{campaign.stats.sent}</b> sent</span>
                        <span><b>{campaign.stats.waiting}</b> waiting</span>
                        <small>{campaign.last_run_at ? `checked ${timeAgo(campaign.last_run_at)}` : 'not run yet'}</small>
                      </div>
                      <footer className="row">
                        <button className="btn btn-small" onClick={() => setEditing(campaign)}>Edit</button>
                        <button className="btn btn-small btn-danger" onClick={() => removeCampaign(campaign)}>Delete</button>
                      </footer>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <SendingSetup key={data.settings.updated_at} settings={data.settings} onSaved={reload} />
        </>
      )}

      {editing && data && (
        <CampaignForm campaign={editing} templates={data.templates} onClose={() => setEditing(null)}
          onSaved={(isNew) => { setEditing(null); toast(isNew ? 'Campaign created' : 'Campaign saved'); reload() }} />
      )}
    </>
  )
}

function ChannelPicker({ value, onChange }) {
  const toggle = (channel) => {
    const next = value.includes(channel) ? value.filter((item) => item !== channel) : [...value, channel]
    if (next.length) onChange(next)
  }
  return (
    <div className="chips">
      {CHANNELS.map((channel) => (
        <button type="button" key={channel.value} className={`chip ${value.includes(channel.value) ? 'on' : ''}`} aria-pressed={value.includes(channel.value)}
          onClick={() => toggle(channel.value)}><Icon name={channel.icon} size={15} /> {channel.label}</button>
      ))}
    </div>
  )
}

function ReminderCard({ kind, reminder, templates, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(reminder)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(reminder)
  const options = templates.filter((template) => template.purpose === kind || template.purpose === 'general')
  const template = templates.find((item) => item.id === form.template_id)
  const upcoming = kind === 'fee_upcoming'

  const save = async (changes = form, message = 'Reminder saved') => {
    setBusy(true)
    const { error } = await supabase.from('fee_reminders').update({
      is_active: changes.is_active, template_id: changes.template_id, channels: changes.channels,
      days_before: Number(changes.days_before), repeat_every_days: Number(changes.repeat_every_days), max_reminders: Number(changes.max_reminders),
      updated_at: new Date().toISOString(),
    }).eq('kind', kind)
    setBusy(false)
    if (error) return toast(error.message, 'error')
    toast(message)
    onSaved()
  }

  const toggle = () => {
    if (!form.template_id) return toast('Pick a template first', 'error')
    const next = { ...form, is_active: !form.is_active }
    setForm(next)
    save(next, next.is_active ? `${purposeLabel(kind)} reminders are on` : `${purposeLabel(kind)} reminders are off`)
  }

  return (
    <article className={`panel reminder-card tilt ${form.is_active ? 'is-live' : ''}`}>
      <header className="panel-head">
        <div className="row">
          <span className={`reminder-icon ${upcoming ? 'soon' : 'late'}`}><Icon name={upcoming ? 'calendar' : 'alert'} size={20} /></span>
          <div>
            <h3>{upcoming ? 'Fee coming up' : 'Fee overdue'}</h3>
            <small className="muted">{reminder.stats.sent} sent · {reminder.stats.waiting} waiting (30 days)</small>
          </div>
        </div>
        <button className={`switch ${form.is_active ? 'on' : ''}`} role="switch" aria-checked={form.is_active} onClick={toggle} disabled={busy}>
          <span />{form.is_active ? 'On' : 'Off'}
        </button>
      </header>
      <p className="reminder-rule">
        {upcoming
          ? <>Send <b>{form.days_before} day{Number(form.days_before) === 1 ? '' : 's'}</b> before a payment is due, once.</>
          : <>Send when a payment date passes, then every <b>{form.repeat_every_days} days</b>, up to <b>{form.max_reminders}</b> times.</>}
      </p>
      <div className="form">
        {upcoming ? (
          <Field label="Days before due date"><input type="number" min="0" max="30" value={form.days_before} onChange={(event) => setForm({ ...form, days_before: event.target.value })} /></Field>
        ) : (
          <div className="form-row">
            <Field label="Repeat every (days)"><input type="number" min="1" max="60" value={form.repeat_every_days} onChange={(event) => setForm({ ...form, repeat_every_days: event.target.value })} /></Field>
            <Field label="Stop after"><input type="number" min="1" max="20" value={form.max_reminders} onChange={(event) => setForm({ ...form, max_reminders: event.target.value })} /></Field>
          </div>
        )}
        <Field label="Template">
          <select value={form.template_id || ''} onChange={(event) => setForm({ ...form, template_id: event.target.value || null })}>
            <option value="">Choose…</option>
            {options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        <div><span className="field-label">Send by</span><ChannelPicker value={form.channels} onChange={(channels) => setForm({ ...form, channels })} /></div>
        {template && <div className="bubble bubble-small"><p>{fillSample(template.body)}</p></div>}
        {dirty && <div className="row end"><button className="btn btn-primary btn-small" onClick={() => save()} disabled={busy}>Save changes</button></div>}
      </div>
    </article>
  )
}

function CampaignForm({ campaign, templates, onClose, onSaved }) {
  const { user } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({
    name: campaign.name || '',
    description: campaign.description || '',
    template_id: campaign.template_id || templates.find((item) => item.purpose === 'lead_follow_up')?.id || '',
    channels: campaign.channels || ['whatsapp'],
    every_days: campaign.every_days || 3,
    lead_stages: campaign.lead_stages || OPEN_STAGES.map((stage) => stage.key),
    audience: campaign.audience || 'all_leads',
    is_active: campaign.is_active ?? false,
  })
  const [picked, setPicked] = useState(() => new Set((campaign.members || [])
    .filter((row) => row.mode === ((campaign.audience || 'all_leads') === 'all_leads' ? 'exclude' : 'include')).map((row) => row.lead_id)))
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const { data } = useLoad(async () => ({
    leads: await must(supabase.from('leads').select('id, full_name, stage, whatsapp, email, opted_out, members(full_name)')
      .not('stage', 'in', '(enrolled,lost)').order('full_name')),
  }), [])

  const inStages = useMemo(() => (data?.leads || []).filter((lead) => form.lead_stages.includes(lead.stage)), [data, form.lead_stages])
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return inStages.filter((lead) => !needle || [lead.full_name, lead.whatsapp, lead.email].join(' ').toLowerCase().includes(needle))
  }, [inStages, query])
  const reach = form.audience === 'all_leads'
    ? inStages.filter((lead) => !picked.has(lead.id) && !lead.opted_out).length
    : inStages.filter((lead) => picked.has(lead.id) && !lead.opted_out).length

  const togglePick = (id) => setPicked((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const toggleStage = (key) => {
    const next = form.lead_stages.includes(key) ? form.lead_stages.filter((item) => item !== key) : [...form.lead_stages, key]
    if (next.length) setForm({ ...form, lead_stages: next })
  }
  const switchAudience = (audience) => { setForm({ ...form, audience }); setPicked(new Set()) }

  const save = async (event) => {
    event.preventDefault()
    if (!form.template_id) return toast('Pick a template', 'error')
    if (form.audience === 'selected_leads' && picked.size === 0) return toast('Tick at least one lead', 'error')
    setBusy(true)
    const payload = {
      name: form.name.trim(), description: form.description.trim() || null, template_id: form.template_id,
      channels: form.channels, every_days: Number(form.every_days), lead_stages: form.lead_stages,
      audience: form.audience, is_active: form.is_active,
    }
    const result = campaign.id
      ? await supabase.from('campaigns').update(payload).eq('id', campaign.id).select('id').single()
      : await supabase.from('campaigns').insert({ ...payload, created_by: user.id }).select('id').single()
    if (result.error) { setBusy(false); return toast(result.error.message, 'error') }
    const campaignId = result.data.id
    const cleared = await supabase.from('campaign_memberships').delete().eq('campaign_id', campaignId)
    if (cleared.error) { setBusy(false); return toast(cleared.error.message, 'error') }
    if (picked.size) {
      const mode = form.audience === 'all_leads' ? 'exclude' : 'include'
      const added = await supabase.from('campaign_memberships').insert([...picked].map((leadId) => ({ campaign_id: campaignId, lead_id: leadId, mode })))
      if (added.error) { setBusy(false); return toast(added.error.message, 'error') }
    }
    setBusy(false)
    onSaved(!campaign.id)
  }

  const template = templates.find((item) => item.id === form.template_id)

  return (
    <Modal title={campaign.id ? `Edit ${campaign.name}` : 'New lead campaign'} onClose={onClose} wide>
      <form className="form" onSubmit={save}>
        <div className="campaign-editor">
          <div className="form">
            <Field label="Campaign name"><input required autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Weekly nudge" /></Field>
            <Field label="Note for the team" hint="Optional"><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
            <div className="form-row">
              <Field label="Template">
                <select value={form.template_id} onChange={(event) => setForm({ ...form, template_id: event.target.value })} required>
                  <option value="">Choose…</option>
                  {templates.filter((item) => ['lead_follow_up', 'general', 'broadcast'].includes(item.purpose))
                    .map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <Field label="Send every (days)"><input type="number" min="1" max="90" required value={form.every_days} onChange={(event) => setForm({ ...form, every_days: event.target.value })} /></Field>
            </div>
            <div><span className="field-label">Send by</span><ChannelPicker value={form.channels} onChange={(channels) => setForm({ ...form, channels })} /></div>
            <div>
              <span className="field-label">Leads in these stages</span>
              <div className="chips">
                {OPEN_STAGES.map((stage) => (
                  <button type="button" key={stage.key} className={`chip ${form.lead_stages.includes(stage.key) ? 'on' : ''}`} onClick={() => toggleStage(stage.key)}>{stage.label}</button>
                ))}
              </div>
            </div>
            {template && <div className="bubble bubble-small"><p>{fillSample(template.body)}</p></div>}
            <label className="check"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Start running straight away</label>
          </div>

          <div className="lead-picker">
            <Segmented label="Who gets it" value={form.audience} onChange={switchAudience}
              options={[{ value: 'all_leads', label: 'All leads' }, { value: 'selected_leads', label: 'Only chosen' }]} />
            <p className="reach"><b>{reach}</b> lead{reach === 1 ? '' : 's'} will get this{form.audience === 'all_leads' ? '. Untick anyone to leave them out.' : '. Tick the leads to include.'}</p>
            <Search value={query} onChange={setQuery} placeholder="Find a lead" />
            <ul className="pick-list">
              {!data ? <li><Loading rows={3} /></li> : shown.length === 0 ? <li className="muted small">No open leads in those stages.</li> : shown.map((lead) => {
                const included = form.audience === 'all_leads' ? !picked.has(lead.id) : picked.has(lead.id)
                return (
                  <li key={lead.id}>
                    <label className={`pick ${lead.opted_out ? 'pick-off' : ''}`}>
                      <input type="checkbox" checked={included && !lead.opted_out} disabled={lead.opted_out} onChange={() => togglePick(lead.id)} />
                      <span><b>{lead.full_name}</b><small>{stageLabel(lead.stage)}{lead.members?.full_name ? ` · ${lead.members.full_name}` : ''}{lead.opted_out ? ' · opted out' : ''}</small></span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : campaign.id ? 'Save campaign' : 'Create campaign'}</button>
        </div>
      </form>
    </Modal>
  )
}

function SendingSetup({ settings, onSaved }) {
  const toast = useToast()
  const { member } = useAuth()
  const [form, setForm] = useState(settings)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const [checking, setChecking] = useState(false)
  const [test, setTest] = useState({ channel: 'email', to: member?.email || '' })
  const dirty = JSON.stringify(form) !== JSON.stringify(settings)
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('messaging_settings').update({
      sender_name: form.sender_name.trim() || 'TecTerminal Umuahia',
      reply_to_email: form.reply_to_email?.trim() || null,
      site_url: form.site_url?.trim().replace(/\/+$/, '') || null,
      whatsapp_mode: form.whatsapp_mode,
      whatsapp_template_name: form.whatsapp_template_name?.trim() || null,
      whatsapp_template_language: form.whatsapp_template_language?.trim() || 'en',
      ...(form.whatsapp_daily_limit !== undefined ? {
        whatsapp_daily_limit: Math.min(1000, Math.max(1, Number(form.whatsapp_daily_limit) || 120)),
        whatsapp_gap_seconds: Math.min(120, Math.max(5, Number(form.whatsapp_gap_seconds) || 8)),
      } : {}),
      email_enabled: form.email_enabled,
      updated_at: new Date().toISOString(),
    }).eq('id', true)
    setBusy(false)
    if (error) return toast(error.message, 'error')
    toast('Sending settings saved')
    onSaved()
  }

  const check = async () => {
    setChecking(true)
    try { setStatus(await callSender({ action: 'status' })) } catch (checkError) { setStatus({ error: checkError.message }) }
    setChecking(false)
  }

  const sendTest = async () => {
    setChecking(true)
    try {
      await callSender({ action: 'test', channel: test.channel, to: test.to })
      toast(`Test ${test.channel === 'email' ? 'email' : 'WhatsApp'} sent to ${test.to}`)
    } catch (testError) { toast(testError.message, 'error') }
    setChecking(false)
  }

  return (
    <section className="auto-section">
      <div className="section-title">
        <h2>Sending setup</h2>
        <p className="muted">How messages leave the building. The README walks through connecting email and WhatsApp.</p>
      </div>
      <div className="split">
        <form className="panel form" onSubmit={save}>
          <h3>Settings</h3>
          <div className="form-row">
            <Field label="Sender name"><input value={form.sender_name} onChange={update('sender_name')} /></Field>
            <Field label="Replies go to" hint="Optional email"><input type="email" value={form.reply_to_email || ''} onChange={update('reply_to_email')} /></Field>
          </div>
          <Field label="Website address" hint="Your Vercel address — used for the “stop receiving” link">
            <input type="url" value={form.site_url || ''} onChange={update('site_url')} placeholder="https://tecterminal-ledger.vercel.app" />
          </Field>
          <label className="check"><input type="checkbox" checked={form.email_enabled} onChange={update('email_enabled')} /> Send emails automatically</label>
          <div>
            <span className="field-label">WhatsApp</span>
            <Segmented label="WhatsApp sending" value={form.whatsapp_mode} onChange={(whatsapp_mode) => setForm({ ...form, whatsapp_mode })}
              options={[
                { value: 'manual', label: 'Tap to send (free)' },
                { value: 'gateway', label: 'Automatic (linked number)' },
                { value: 'cloud_api', label: 'Automatic (Meta API)' },
              ]} />
          </div>
          {form.whatsapp_mode === 'manual' ? (
            <p className="muted small">Due WhatsApp messages wait in the Outbox. Each marketer taps <b>Send</b>, WhatsApp opens with the message typed, they press send. No cost, no Meta approval.</p>
          ) : form.whatsapp_mode === 'gateway' ? (
            <>
              <p className="note">Sends from the centre&rsquo;s own WhatsApp number linked through GREEN-API, between 8:00 and 20:00 only, one message at a time.
                This isn&rsquo;t Meta&rsquo;s official route, so use a <b>dedicated number</b> (never a marketer&rsquo;s personal one) and keep the daily limit modest to avoid a ban.</p>
              <div className="form-row">
                <Field label="Most messages per day" hint="Start around 50–100, raise slowly">
                  <input type="number" min="1" max="1000" value={form.whatsapp_daily_limit ?? 120} onChange={update('whatsapp_daily_limit')} />
                </Field>
                <Field label="Seconds between messages" hint="At least 5; 8–15 looks human">
                  <input type="number" min="5" max="120" value={form.whatsapp_gap_seconds ?? 8} onChange={update('whatsapp_gap_seconds')} />
                </Field>
              </div>
            </>
          ) : (
            <div className="form-row">
              <Field label="Approved template name" hint="A Meta template whose body is just {{1}}"><input value={form.whatsapp_template_name || ''} onChange={update('whatsapp_template_name')} placeholder="tecterminal_message" /></Field>
              <Field label="Template language"><input value={form.whatsapp_template_language || 'en'} onChange={update('whatsapp_template_language')} /></Field>
            </div>
          )}
          {dirty && <div className="row end"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>}
        </form>

        <div className="panel">
          <div className="panel-head">
            <h3>Connection</h3>
            <button className="btn btn-small" onClick={check} disabled={checking}><Icon name="refresh" size={15} /> Check</button>
          </div>
          {!status ? <p className="muted small">Check whether the send-messages function is deployed and its keys are in place.</p>
            : status.error ? <p className="note note-error">{status.error}</p> : (
              <ul className="status-list">
                <li className={status.email.ready ? 'ok' : 'bad'}><Icon name={status.email.ready ? 'check' : 'close'} size={16} />
                  Email {status.email.ready ? `ready via ${status.email.provider} from ${status.email.from}` : 'not set up — add EMAIL_PROVIDER, its API key and EMAIL_FROM_ADDRESS'}</li>
                {(() => {
                  const mode = status.whatsapp.mode
                  const linked = status.whatsapp.gatewayState === 'authorized'
                  const ok = mode === 'manual' || (mode === 'gateway' ? status.whatsapp.ready && linked : status.whatsapp.ready)
                  const text = mode === 'manual' ? 'WhatsApp in tap-to-send mode'
                    : mode === 'gateway'
                      ? (!status.whatsapp.ready ? 'WhatsApp gateway needs GREENAPI_URL, GREENAPI_INSTANCE and GREENAPI_TOKEN'
                        : linked ? 'WhatsApp number linked and sending automatically'
                          : `WhatsApp number not linked (${status.whatsapp.gatewayState || 'unknown'}) — scan the QR code in GREEN-API`)
                      : status.whatsapp.ready ? 'WhatsApp ready via Meta Cloud API' : 'Meta Cloud API needs WHATSAPP_TOKEN, WHATSAPP_PHONE_ID and a template name'
                  return <li className={ok ? 'ok' : 'bad'}><Icon name={ok ? 'check' : 'close'} size={16} />{text}</li>
                })()}
                <li className={status.cronSecret ? 'ok' : 'bad'}><Icon name={status.cronSecret ? 'check' : 'close'} size={16} />
                  {status.cronSecret ? 'Automatic sending every 10 minutes can run' : 'Add CRON_SECRET so the 10-minute job can run'}</li>
              </ul>
            )}
          <div className="form test-send">
            <span className="field-label">Send yourself a test</span>
            <div className="row">
              <select className="chip-select" value={test.channel} onChange={(event) => setTest({ ...test, channel: event.target.value })} aria-label="Channel">
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
              <input value={test.to} onChange={(event) => setTest({ ...test, to: event.target.value })} placeholder={test.channel === 'email' ? 'you@example.com' : '0803…'} aria-label="Send test to" />
              <button className="btn btn-small" onClick={sendTest} disabled={checking || !test.to}><Icon name="send" size={15} /> Send</button>
            </div>
          </div>
          <p className="muted small">Templates live on the <Link className="link" to="/templates">Templates</Link> page; every message is tracked in the <Link className="link" to="/outbox">Outbox</Link>.</p>
        </div>
      </div>
    </section>
  )
}
