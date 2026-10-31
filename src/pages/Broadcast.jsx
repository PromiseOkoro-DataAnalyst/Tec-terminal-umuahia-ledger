import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { useAuth } from '../context/auth'
import { useToast } from '../components/toast'
import { STAGES, dayLabel, naira, timeAgo } from '../lib/format'
import { CHANNELS, PLACEHOLDERS, fillSample, mediaName, mediaUrl } from '../lib/messaging'
import Icon from '../components/Icon'
import { Empty, ErrorNote, Field, Loading, PageHead, Search, Segmented } from '../components/ui'

const OPEN_STAGES = STAGES.filter((stage) => stage.key !== 'enrolled')
const MAX_FILE_MB = 16

export default function Broadcast() {
  const { user } = useAuth()
  const toast = useToast()
  const [step, setStep] = useState('compose')
  const [form, setForm] = useState({ title: '', subject: '', body: '', channels: ['whatsapp'] })
  const [media, setMedia] = useState([])
  const [uploading, setUploading] = useState(false)
  const [leadStages, setLeadStages] = useState([])
  const [studentGroup, setStudentGroup] = useState('none')
  const [left, setLeft] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [sending, setSending] = useState(false)

  const { data, error, reload } = useLoad(async () => {
    const [templates, leads, students, history, deliveries] = await Promise.all([
      must(supabase.from('message_templates').select('id, name, purpose, subject, body').in('purpose', ['broadcast', 'general']).order('name')),
      must(supabase.from('leads').select('id, full_name, stage, whatsapp, email, opted_out').order('full_name')),
      must(supabase.from('student_accounts').select('student_id, full_name, status, whatsapp, email, balance, course_name, opted_out').order('full_name')),
      must(supabase.from('broadcasts').select('*, members(full_name)').order('created_at', { ascending: false }).limit(30)),
      must(supabase.from('message_log').select('broadcast_id, status').not('broadcast_id', 'is', null)),
    ])
    const tally = (id) => ({
      sent: deliveries.filter((row) => row.broadcast_id === id && row.status === 'sent').length,
      waiting: deliveries.filter((row) => row.broadcast_id === id && row.status === 'queued').length,
      failed: deliveries.filter((row) => row.broadcast_id === id && row.status === 'failed').length,
    })
    return { templates, leads, students, history: history.map((item) => ({ ...item, tally: tally(item.id) })) }
  }, [])

  // Everyone the audience choices add up to, before anyone is left out
  const audience = useMemo(() => {
    if (!data) return []
    const leads = data.leads.filter((lead) => leadStages.includes(lead.stage))
      .map((lead) => ({ key: `l-${lead.id}`, id: lead.id, kind: 'lead', name: lead.full_name, note: STAGES.find((stage) => stage.key === lead.stage)?.label, whatsapp: lead.whatsapp, email: lead.email, opted_out: lead.opted_out }))
    const students = data.students.filter((student) =>
      studentGroup === 'all' ? student.status === 'active'
        : studentGroup === 'owing' ? student.status === 'active' && Number(student.balance) > 0
          : studentGroup === 'everyone' ? true : false)
      .map((student) => ({ key: `s-${student.student_id}`, id: student.student_id, kind: 'student', name: student.full_name,
        note: `${student.course_name}${Number(student.balance) > 0 ? ` · owes ${naira(student.balance)}` : ''}`, whatsapp: student.whatsapp, email: student.email, opted_out: student.opted_out }))
    return [...leads, ...students]
  }, [data, leadStages, studentGroup])

  const chosen = audience.filter((person) => !left.has(person.key) && !person.opted_out)
  const reachable = (channel) => chosen.filter((person) => (channel === 'email' ? person.email : person.whatsapp)).length
  const totalMessages = form.channels.reduce((sum, channel) => sum + reachable(channel), 0)

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return audience.filter((person) => !needle || [person.name, person.whatsapp, person.email, person.note].join(' ').toLowerCase().includes(needle))
  }, [audience, query])

  const toggleStage = (key) => setLeadStages((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))
  const toggleChannel = (channel) => {
    const next = form.channels.includes(channel) ? form.channels.filter((item) => item !== channel) : [...form.channels, channel]
    if (next.length) setForm({ ...form, channels: next })
  }
  const toggleLeft = (key) => setLeft((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const applyTemplate = (id) => {
    const template = data.templates.find((item) => item.id === id)
    if (template) setForm({ ...form, title: form.title || template.name, subject: template.subject || '', body: template.body })
  }

  const upload = async (event) => {
    const files = [...event.target.files]
    event.target.value = ''
    const tooBig = files.find((file) => file.size > MAX_FILE_MB * 1024 * 1024)
    if (tooBig) return toast(`${tooBig.name} is over ${MAX_FILE_MB} MB — WhatsApp and email won’t carry it`, 'error')
    setUploading(true)
    const added = []
    for (const file of files) {
      const safe = file.name.replace(/[^\w.-]+/g, '-')
      const path = `${new Date().toISOString().slice(0, 7)}/${Date.now()}-${safe}`
      const { error: uploadError } = await supabase.storage.from('broadcast-media').upload(path, file, { contentType: file.type })
      if (uploadError) { toast(uploadError.message, 'error'); continue }
      added.push(path)
    }
    setMedia((current) => [...current, ...added])
    setUploading(false)
  }

  const send = async () => {
    setSending(true)
    const { data: created, error: createError } = await supabase.from('broadcasts').insert({
      title: form.title.trim() || 'Broadcast', subject: form.subject.trim() || null, body: form.body.trim(),
      channels: form.channels, media_paths: media, created_by: user.id,
      audience_summary: [
        leadStages.length && `Leads: ${leadStages.map((key) => STAGES.find((stage) => stage.key === key)?.label).join(', ')}`,
        studentGroup !== 'none' && `Students: ${{ all: 'active', owing: 'owing', everyone: 'all' }[studentGroup]}`,
        left.size && `${left.size} left out`,
      ].filter(Boolean).join(' · '),
    }).select('id').single()
    if (createError) { setSending(false); return toast(createError.message, 'error') }
    const { data: queued, error: queueError } = await supabase.rpc('queue_broadcast', {
      target_broadcast_id: created.id,
      lead_ids: chosen.filter((person) => person.kind === 'lead').map((person) => person.id),
      student_ids: chosen.filter((person) => person.kind === 'student').map((person) => person.id),
    })
    setSending(false)
    if (queueError) return toast(queueError.message, 'error')
    toast(`${queued} message${queued === 1 ? '' : 's'} queued — track them in the Outbox`)
    setForm({ title: '', subject: '', body: '', channels: form.channels })
    setMedia([])
    setLeft(new Set())
    setStep('compose')
    reload()
  }

  const canReview = form.body.trim() && audience.length > 0

  return (
    <>
      <PageHead title="Broadcast board" sub="One message to many leads and students, on WhatsApp, email or both." />
      <ErrorNote>{error}</ErrorNote>
      {!data ? <Loading rows={6} /> : (
        <>
          <ol className="stepper" aria-label="Steps">
            {[['compose', 'Write'], ['audience', 'Choose who'], ['review', 'Review & send']].map(([key, label], index) => (
              <li key={key} className={step === key ? 'on' : ''}>
                <button onClick={() => (key === 'review' && !canReview ? null : setStep(key))} disabled={key === 'review' && !canReview}>
                  <span>{index + 1}</span>{label}
                </button>
              </li>
            ))}
          </ol>

          {step === 'compose' && (
            <div className="broadcast-grid">
              <section className="panel form">
                <div className="form-row">
                  <Field label="Title" hint="Only you see this"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. November open day" /></Field>
                  <Field label="Start from a template">
                    <select value="" onChange={(event) => applyTemplate(event.target.value)}>
                      <option value="">Choose…</option>
                      {data.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                    </select>
                  </Field>
                </div>
                <div><span className="field-label">Send by</span>
                  <div className="chips">
                    {CHANNELS.map((channel) => (
                      <button type="button" key={channel.value} className={`chip ${form.channels.includes(channel.value) ? 'on' : ''}`} aria-pressed={form.channels.includes(channel.value)}
                        onClick={() => toggleChannel(channel.value)}><Icon name={channel.icon} size={15} /> {channel.label}</button>
                    ))}
                  </div>
                </div>
                {form.channels.includes('email') && (
                  <Field label="Email subject"><input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="e.g. You’re invited: TecTerminal open day" /></Field>
                )}
                <Field label="Message" hint="{{first_name}}, {{course}} and the other placeholders fill in for each person">
                  <textarea rows={9} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder={'Hello {{first_name}},\n\n…'} />
                </Field>
                <div className="chips placeholder-chips">
                  {PLACEHOLDERS.filter((item) => ['first_name', 'full_name', 'course', 'marketer_name', 'marketer_whatsapp'].includes(item.key)).map((item) => (
                    <button type="button" key={item.key} className="chip chip-quiet" onClick={() => setForm({ ...form, body: `${form.body}{{${item.key}}}` })}>{item.label}</button>
                  ))}
                </div>
                <div>
                  <span className="field-label">Pictures, videos or files</span>
                  <div className="chips">
                    {media.map((path) => (
                      <span key={path} className="chip attach">
                        <Icon name="paperclip" size={14} /><a href={mediaUrl(path)} target="_blank" rel="noreferrer">{mediaName(path)}</a>
                        <button type="button" onClick={() => setMedia(media.filter((item) => item !== path))} aria-label={`Remove ${mediaName(path)}`}><Icon name="close" size={13} /></button>
                      </span>
                    ))}
                    <label className={`chip chip-quiet ${uploading ? 'busy' : ''}`}>
                      <Icon name="upload" size={15} /> {uploading ? 'Uploading…' : 'Add files'}
                      <input type="file" multiple accept="image/*,video/*,application/pdf" onChange={upload} hidden />
                    </label>
                  </div>
                  <small className="field-hint">Email attaches them. WhatsApp adds a link to each file under the message.</small>
                </div>
                <div className="row end"><button className="btn btn-primary" disabled={!form.body.trim()} onClick={() => setStep('audience')}>Next: choose who <Icon name="arrowRight" size={18} /></button></div>
              </section>
              <Preview form={form} media={media} />
            </div>
          )}

          {step === 'audience' && (
            <div className="broadcast-grid">
              <section className="panel">
                <h3>Leads</h3>
                <div className="chips">
                  {OPEN_STAGES.map((stage) => {
                    const count = data.leads.filter((lead) => lead.stage === stage.key).length
                    return <button key={stage.key} className={`chip ${leadStages.includes(stage.key) ? 'on' : ''}`} onClick={() => toggleStage(stage.key)}>{stage.label} <small>{count}</small></button>
                  })}
                </div>
                <h3>Students</h3>
                <Segmented label="Students" value={studentGroup} onChange={setStudentGroup}
                  options={[{ value: 'none', label: 'None' }, { value: 'all', label: 'Active' }, { value: 'owing', label: 'Owing' }, { value: 'everyone', label: 'All, past too' }]} />
                <div className="reach-card">
                  <b>{chosen.length}</b><span>people chosen</span>
                  {form.channels.map((channel) => <small key={channel}><Icon name={channel === 'email' ? 'mail' : 'whatsapp'} size={13} /> {reachable(channel)} have {channel === 'email' ? 'an email' : 'WhatsApp'}</small>)}
                </div>
                <div className="row end">
                  <button className="btn" onClick={() => setStep('compose')}>Back</button>
                  <button className="btn btn-primary" disabled={!canReview} onClick={() => setStep('review')}>Review <Icon name="arrowRight" size={18} /></button>
                </div>
              </section>
              <section className="panel lead-picker">
                <div className="panel-head"><h3>Everyone chosen</h3><span className="muted small">Untick to leave someone out</span></div>
                <Search value={query} onChange={setQuery} placeholder="Find someone" />
                <ul className="pick-list tall">
                  {shown.length === 0 ? <li className="muted small">Pick lead stages or a student group.</li> : shown.map((person) => (
                    <li key={person.key}>
                      <label className={`pick ${person.opted_out ? 'pick-off' : ''}`}>
                        <input type="checkbox" checked={!left.has(person.key) && !person.opted_out} disabled={person.opted_out} onChange={() => toggleLeft(person.key)} />
                        <span><b>{person.name}</b><small>{person.kind === 'lead' ? 'Lead' : 'Student'} · {person.note}{person.opted_out ? ' · opted out' : ''}</small></span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}

          {step === 'review' && (
            <div className="broadcast-grid">
              <section className="panel review">
                <h3>{form.title || 'Broadcast'}</h3>
                <dl className="facts">
                  <div><dt>People</dt><dd>{chosen.length}</dd></div>
                  <div><dt>Messages</dt><dd>{totalMessages}</dd></div>
                  {form.channels.map((channel) => <div key={channel}><dt>{channel === 'email' ? 'Email' : 'WhatsApp'}</dt><dd>{reachable(channel)}</dd></div>)}
                  <div><dt>Attachments</dt><dd>{media.length || 'None'}</dd></div>
                </dl>
                {chosen.length - Math.max(...form.channels.map(reachable)) > 0 && (
                  <p className="note">{chosen.length - Math.max(...form.channels.map(reachable))} people have no {form.channels.join(' or ')} on record and will be skipped.</p>
                )}
                <p className="muted small">Emails go out within 10 minutes. {form.channels.includes('whatsapp') && 'WhatsApp messages go out automatically on the Cloud API, or wait in each marketer’s Outbox in tap-to-send mode.'}</p>
                <div className="row end">
                  <button className="btn" onClick={() => setStep('audience')}>Back</button>
                  <button className="btn btn-primary btn-lg" onClick={send} disabled={sending || totalMessages === 0}>
                    <Icon name="megaphone" size={18} /> {sending ? 'Sending…' : `Send ${totalMessages} message${totalMessages === 1 ? '' : 's'}`}
                  </button>
                </div>
              </section>
              <Preview form={form} media={media} />
            </div>
          )}

          <section className="auto-section">
            <div className="section-title"><h2>History</h2></div>
            {data.history.length === 0 ? <Empty icon="megaphone" title="No broadcasts yet">Your sent broadcasts and how many got through will show here.</Empty> : (
              <div className="table-card">
                <table className="table">
                  <thead><tr><th>Broadcast</th><th>Who</th><th>By</th><th className="num">Sent</th><th className="num">Waiting</th><th className="num">Failed</th><th>When</th></tr></thead>
                  <tbody>
                    {data.history.map((item) => (
                      <tr key={item.id}>
                        <td data-label="Broadcast"><b>{item.title}</b><div className="muted small">{item.channels.map((channel) => (channel === 'email' ? 'Email' : 'WhatsApp')).join(' + ')}{item.media_paths.length ? ` · ${item.media_paths.length} file${item.media_paths.length === 1 ? '' : 's'}` : ''}</div></td>
                        <td data-label="Who" className="small">{item.audience_summary || '—'}</td>
                        <td data-label="By">{item.members?.full_name || '—'}</td>
                        <td data-label="Sent" className="num money-in">{item.tally.sent}</td>
                        <td data-label="Waiting" className="num">{item.tally.waiting}</td>
                        <td data-label="Failed" className={`num ${item.tally.failed ? 'money-owed' : ''}`}>{item.tally.failed}</td>
                        <td data-label="When" title={dayLabel(item.sent_at || item.created_at)}>{item.sent_at ? timeAgo(item.sent_at) : 'Draft'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}

function Preview({ form, media }) {
  const [view, setView] = useState(form.channels[0] || 'whatsapp')
  const current = form.channels.includes(view) ? view : form.channels[0]
  const images = media.filter((path) => /\.(png|jpe?g|gif|webp)$/i.test(path))
  return (
    <aside className="template-preview sticky">
      {form.channels.length > 1 && (
        <Segmented label="Preview" value={current} onChange={setView}
          options={[{ value: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' }, { value: 'email', label: 'Email', icon: 'mail' }]} />
      )}
      {current === 'whatsapp' ? (
        <div className="phone">
          <div className="phone-bar"><Icon name="whatsapp" size={16} /> TecTerminal Umuahia</div>
          <div className="phone-chat">
            <div className="bubble bubble-out">
              <p>{fillSample(form.body) || 'Your message appears here.'}</p>
              {media.map((path) => <span key={path} className="bubble-link">{mediaName(path)}</span>)}
              <small>9:41</small>
            </div>
          </div>
        </div>
      ) : (
        <div className="mail-preview">
          <div className="mail-stripe" />
          <b className="mail-from">TecTerminal Umuahia</b>
          <h4>{fillSample(form.subject) || 'Subject line'}</h4>
          <p>{fillSample(form.body) || 'Your message appears here.'}</p>
          {images.map((path) => <img key={path} src={mediaUrl(path)} alt="" />)}
          <small>Stop receiving these messages</small>
        </div>
      )}
      <p className="muted small">Sample details shown. Each person gets their own.</p>
    </aside>
  )
}
