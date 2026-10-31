import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { useAuth } from '../context/auth'
import { useToast } from './toast'
import { STAGES, addDaysISO, naira, timeAgo, todayISO, whatsappLink } from '../lib/format'
import Icon from './Icon'
import MessageComposer from './MessageComposer'
import { Drawer, ErrorNote, Field, FollowUpChip, Loading } from './ui'

const KINDS = [
  { value: 'call', label: 'Call', icon: 'phone' },
  { value: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' },
  { value: 'visit', label: 'Visit', icon: 'visit' },
  { value: 'email', label: 'Email', icon: 'mail' },
  { value: 'note', label: 'Note', icon: 'note' },
]
const BLANK = { full_name: '', whatsapp: '', email: '', course_id: '', source: '', notes: '', stage: 'new', opted_out: false }
const SOURCES = ['Walk-in', 'Referral', 'Instagram', 'Facebook', 'TikTok', 'WhatsApp', 'Flyer', 'Event']

// Opens one lead (leadId) or a blank form for a new lead (leadId = null)
export default function LeadDrawer({ leadId: initialId, onClose, onChanged }) {
  const { isAdmin, user } = useAuth()
  const toast = useToast()
  const [leadId, setLeadId] = useState(initialId)
  const [enrolling, setEnrolling] = useState(false)
  const [messaging, setMessaging] = useState(false)

  const { data, error, reload } = useLoad(async () => {
    const [courses, members, lead, interactions] = await Promise.all([
      must(supabase.from('courses').select('id, name, standard_fee').eq('is_active', true).order('name')),
      isAdmin ? must(supabase.from('members').select('id, full_name, email').eq('status', 'active').order('full_name')) : [],
      leadId ? must(supabase.from('leads').select('*, courses(name), members(full_name)').eq('id', leadId).single()) : null,
      leadId ? must(supabase.from('lead_interactions').select('*, members(full_name)').eq('lead_id', leadId).order('created_at', { ascending: false })) : [],
    ])
    return { courses, members, lead, interactions }
  }, [leadId, isAdmin])

  const refresh = () => { reload(); onChanged?.() }

  const patch = async (changes, message) => {
    const { error: saveError } = await supabase.from('leads').update(changes).eq('id', leadId)
    if (saveError) return toast(saveError.message, 'error')
    if (message) toast(message)
    refresh()
  }

  const lead = data?.lead
  const firstName = lead?.full_name.split(' ')[0]

  return (
    <Drawer
      title={leadId ? (lead?.full_name || 'Lead') : 'New lead'}
      sub={lead ? [lead.courses?.name, lead.source, isAdmin && lead.members?.full_name && `with ${lead.members.full_name}`].filter(Boolean).join(' · ') : 'Record an enquiry so nobody slips through.'}
      onClose={onClose}>
      <ErrorNote>{error}</ErrorNote>
      {!data ? <Loading rows={6} /> : (
        <>
          {lead && (
            <>
              <div className="contact-row">
                {lead.whatsapp && (
                  <a className="btn btn-whatsapp" href={whatsappLink(lead.whatsapp, `Hello ${firstName}, this is TecTerminal Umuahia.`)} target="_blank" rel="noreferrer">
                    <Icon name="whatsapp" size={18} /> WhatsApp
                  </a>
                )}
                {lead.whatsapp && <a className="btn" href={`tel:${lead.whatsapp.replace(/\s/g, '')}`}><Icon name="phone" size={18} /> Call</a>}
                {lead.email && <a className="btn" href={`mailto:${lead.email}`}><Icon name="mail" size={18} /> Email</a>}
                {(lead.whatsapp || lead.email) && !lead.opted_out && (
                  <button className="btn btn-primary" onClick={() => setMessaging(true)}><Icon name="template" size={18} /> Use a template</button>
                )}
              </div>
              {messaging && (
                <MessageComposer person={{ kind: 'lead', id: lead.id, name: lead.full_name, whatsapp: lead.whatsapp, email: lead.email }}
                  onClose={() => setMessaging(false)} onSent={refresh} />
              )}

              <section className="drawer-section">
                <h3>Stage</h3>
                <div className="stage-picker" role="radiogroup" aria-label="Stage">
                  {STAGES.filter((stage) => stage.key !== 'enrolled' || lead.stage === 'enrolled').map((stage) => (
                    <button key={stage.key} role="radio" aria-checked={lead.stage === stage.key}
                      className={`stage-option stage-${stage.key} ${lead.stage === stage.key ? 'on' : ''}`}
                      onClick={() => lead.stage !== stage.key && patch({ stage: stage.key }, `Moved to ${stage.label}`)}>
                      <i aria-hidden="true" />{stage.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="drawer-section">
                <h3>Next follow-up {lead.next_follow_up_on && <FollowUpChip date={lead.next_follow_up_on} />}</h3>
                <div className="chips">
                  {[['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]].map(([label, days]) => (
                    <button key={label} className={`chip ${lead.next_follow_up_on === addDaysISO(days) ? 'on' : ''}`}
                      onClick={() => patch({ next_follow_up_on: addDaysISO(days) }, `Follow-up set for ${label.toLowerCase()}`)}>
                      {label}
                    </button>
                  ))}
                  <input type="date" className="chip-date" aria-label="Pick a follow-up date" value={lead.next_follow_up_on || ''}
                    onChange={(event) => event.target.value && patch({ next_follow_up_on: event.target.value }, 'Follow-up date saved')} />
                  {lead.next_follow_up_on && <button className="chip chip-quiet" onClick={() => patch({ next_follow_up_on: null }, 'Follow-up cleared')}>Clear</button>}
                </div>
              </section>

              {lead.stage !== 'enrolled' && (
                enrolling
                  ? <EnrolForm lead={lead} courses={data.courses} onCancel={() => setEnrolling(false)}
                      onDone={() => { setEnrolling(false); toast(`${firstName} is now a student`); refresh() }} />
                  : <button className="btn btn-primary btn-block" onClick={() => setEnrolling(true)}><Icon name="students" size={18} /> Enrol {firstName}</button>
              )}

              <Timeline leadId={lead.id} interactions={data.interactions} userId={user.id} onLogged={refresh} />
            </>
          )}

          <LeadForm key={lead?.updated_at || 'new'} lead={lead} courses={data.courses} members={data.members} isAdmin={isAdmin}
            onSaved={(id, isNew) => {
              toast(isNew ? 'Lead added' : 'Changes saved')
              if (isNew) setLeadId(id)
              refresh()
            }}
            onDeleted={() => { toast('Lead deleted'); onChanged?.(); onClose() }} />
        </>
      )}
    </Drawer>
  )
}

function Timeline({ leadId, interactions, userId, onLogged }) {
  const toast = useToast()
  const [kind, setKind] = useState('call')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const log = async (event) => {
    event.preventDefault()
    if (!note.trim()) return
    setBusy(true)
    const { error } = await supabase.from('lead_interactions').insert({ lead_id: leadId, kind, note: note.trim(), created_by: userId })
    setBusy(false)
    if (error) return toast(error.message, 'error')
    setNote('')
    toast('Logged')
    onLogged()
  }

  return (
    <section className="drawer-section">
      <h3>Conversation history</h3>
      <form className="log-form" onSubmit={log}>
        <div className="kind-picker" role="radiogroup" aria-label="What happened">
          {KINDS.map((option) => (
            <button type="button" key={option.value} role="radio" aria-checked={kind === option.value}
              className={kind === option.value ? 'on' : ''} onClick={() => setKind(option.value)}>
              <Icon name={option.icon} size={15} /> {option.label}
            </button>
          ))}
        </div>
        <textarea rows={2} placeholder="What was said? e.g. Wants the weekend class, will pay deposit Friday" value={note}
          onChange={(event) => setNote(event.target.value)} />
        <button className="btn btn-small" disabled={busy || !note.trim()}>{busy ? 'Logging…' : 'Log it'}</button>
      </form>
      {interactions.length === 0 ? <p className="muted small">Nothing logged yet.</p> : (
        <ol className="timeline">
          {interactions.map((item) => (
            <li key={item.id}>
              <span className={`timeline-dot kind-${item.kind}`}><Icon name={KINDS.find((option) => option.value === item.kind)?.icon || 'note'} size={13} /></span>
              <p>{item.note}</p>
              <small className="muted">{item.members?.full_name || 'Someone'} · {timeAgo(item.created_at)}</small>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function EnrolForm({ lead, courses, onCancel, onDone }) {
  const toast = useToast()
  const startCourse = courses.find((course) => course.id === lead.course_id) || courses[0]
  const [form, setForm] = useState({
    course_id: startCourse?.id || '',
    fee: startCourse ? String(Number(startCourse.standard_fee)) : '',
    enrolled_on: todayISO(),
    first_payment: '',
    method: 'transfer',
  })
  const [busy, setBusy] = useState(false)
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value })
  const pickCourse = (event) => {
    const course = courses.find((item) => item.id === event.target.value)
    setForm({ ...form, course_id: event.target.value, fee: course ? String(Number(course.standard_fee)) : form.fee })
  }

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    const { error } = await supabase.rpc('enrol_lead', {
      target_lead_id: lead.id,
      target_course_id: form.course_id,
      fee: Number(form.fee),
      enrolment_date: form.enrolled_on,
      first_payment: Number(form.first_payment || 0),
      first_payment_method: form.method,
    })
    setBusy(false)
    if (error) return toast(error.message, 'error')
    onDone()
  }

  if (!courses.length) return <p className="note">Add a course on the Courses page before enrolling students.</p>

  return (
    <form className="panel panel-inset form" onSubmit={submit}>
      <h3>Enrol {lead.full_name}</h3>
      <Field label="Course">
        <select required value={form.course_id} onChange={pickCourse}>
          {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
        </select>
      </Field>
      <div className="form-row">
        <Field label="Agreed fee (₦)" hint="Change it if there’s a discount">
          <input type="number" min="0" step="any" required value={form.fee} onChange={update('fee')} />
        </Field>
        <Field label="Enrolment date"><input type="date" required value={form.enrolled_on} onChange={update('enrolled_on')} /></Field>
      </div>
      <div className="form-row">
        <Field label="First payment (₦)" hint="Leave empty if nothing paid yet">
          <input type="number" min="0" step="any" value={form.first_payment} onChange={update('first_payment')} />
        </Field>
        <Field label="Paid by">
          <select value={form.method} onChange={update('method')}>
            <option value="transfer">Transfer</option><option value="cash">Cash</option><option value="pos">POS</option><option value="other">Other</option>
          </select>
        </Field>
      </div>
      {Number(form.first_payment) > 0 && Number(form.fee) > 0 && (
        <p className="muted small">Balance after this: {naira(Math.max(0, form.fee - form.first_payment))}</p>
      )}
      <div className="row end">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Enrolling…' : 'Enrol student'}</button>
      </div>
    </form>
  )
}

function LeadForm({ lead, courses, members, isAdmin, onSaved, onDeleted }) {
  const toast = useToast()
  const [open, setOpen] = useState(!lead)
  const [form, setForm] = useState(() => (lead
    ? { ...BLANK, ...lead, course_id: lead.course_id || '', whatsapp: lead.whatsapp || '', email: lead.email || '', source: lead.source || '', notes: lead.notes || '' }
    : { ...BLANK, next_follow_up_on: addDaysISO(1) }))
  const [busy, setBusy] = useState(false)
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    const payload = {
      full_name: form.full_name.trim(),
      whatsapp: form.whatsapp.trim() || null,
      email: form.email.trim() || null,
      course_id: form.course_id || null,
      source: form.source.trim() || null,
      notes: form.notes.trim() || null,
      opted_out: form.opted_out,
    }
    if (!lead) Object.assign(payload, { stage: form.stage, next_follow_up_on: form.next_follow_up_on || null })
    if (isAdmin && form.owner_id) payload.owner_id = form.owner_id
    const request = lead
      ? supabase.from('leads').update(payload).eq('id', lead.id).select('id').single()
      : supabase.from('leads').insert(payload).select('id').single()
    const { data, error } = await request
    setBusy(false)
    if (error) return toast(error.message, 'error')
    onSaved(data.id, !lead)
    if (lead) setOpen(false)
  }

  const remove = async () => {
    if (!window.confirm(`Delete ${lead.full_name} and their conversation history? This can’t be undone.`)) return
    const { error } = await supabase.from('leads').delete().eq('id', lead.id)
    if (error) return toast(error.message, 'error')
    onDeleted()
  }

  if (lead && !open) {
    return (
      <section className="drawer-section">
        <h3>Details</h3>
        <dl className="facts">
          <div><dt>WhatsApp</dt><dd>{lead.whatsapp || '—'}</dd></div>
          <div><dt>Email</dt><dd>{lead.email || '—'}</dd></div>
          <div><dt>Course</dt><dd>{lead.courses?.name || '—'}</dd></div>
          <div><dt>Source</dt><dd>{lead.source || '—'}</dd></div>
          {lead.notes && <div className="facts-wide"><dt>Notes</dt><dd>{lead.notes}</dd></div>}
          {lead.opted_out && <div className="facts-wide"><dt>Messages</dt><dd>Opted out of campaign messages</dd></div>}
        </dl>
        <div className="row spread">
          <button className="btn btn-small" onClick={() => setOpen(true)}>Edit details</button>
          {isAdmin && <button className="btn btn-small btn-danger" onClick={remove}><Icon name="trash" size={15} /> Delete lead</button>}
        </div>
      </section>
    )
  }

  return (
    <form className="drawer-section form" onSubmit={save}>
      {lead && <h3>Edit details</h3>}
      <Field label="Full name"><input required value={form.full_name} onChange={update('full_name')} autoFocus={!lead} /></Field>
      <div className="form-row">
        <Field label="WhatsApp"><input value={form.whatsapp} onChange={update('whatsapp')} inputMode="tel" placeholder="0803 000 0000" /></Field>
        <Field label="Email"><input type="email" value={form.email} onChange={update('email')} /></Field>
      </div>
      <div className="form-row">
        <Field label="Course interest">
          <select value={form.course_id} onChange={update('course_id')}>
            <option value="">Not sure yet</option>
            {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
          </select>
        </Field>
        <Field label="Where they heard of us">
          <input list="lead-sources" value={form.source} onChange={update('source')} placeholder="Walk-in, referral…" />
          <datalist id="lead-sources">{SOURCES.map((source) => <option key={source} value={source} />)}</datalist>
        </Field>
      </div>
      {!lead && (
        <div className="form-row">
          <Field label="Stage">
            <select value={form.stage} onChange={update('stage')}>
              {STAGES.filter((stage) => stage.key !== 'enrolled').map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
            </select>
          </Field>
          <Field label="Follow up on"><input type="date" value={form.next_follow_up_on || ''} onChange={update('next_follow_up_on')} /></Field>
        </div>
      )}
      {isAdmin && members.length > 0 && (
        <Field label="Marketer">
          <select value={form.owner_id || ''} onChange={update('owner_id')}>
            <option value="">{lead ? 'Keep current' : 'Me'}</option>
            {members.map((person) => <option key={person.id} value={person.id}>{person.full_name || person.email}</option>)}
          </select>
        </Field>
      )}
      <Field label="Notes"><textarea rows={3} value={form.notes} onChange={update('notes')} /></Field>
      <label className="check"><input type="checkbox" checked={form.opted_out} onChange={update('opted_out')} /> Opted out of campaign messages</label>
      <div className="row end">
        {lead && <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : lead ? 'Save changes' : 'Add lead'}</button>
      </div>
    </form>
  )
}
