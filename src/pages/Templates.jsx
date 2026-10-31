import { useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { useAuth } from '../context/auth'
import { useToast } from '../components/toast'
import { timeAgo } from '../lib/format'
import { PLACEHOLDERS, PURPOSES, fillSample, purposeLabel } from '../lib/messaging'
import Icon from '../components/Icon'
import { Empty, ErrorNote, Field, Loading, Modal, PageHead, Search, Segmented } from '../components/ui'

export default function Templates() {
  const { isAdmin, user } = useAuth()
  const toast = useToast()
  const [purpose, setPurpose] = useState('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)

  const { data, error, reload } = useLoad(async () => {
    const [templates, campaigns, reminders] = await Promise.all([
      must(supabase.from('message_templates').select('*, members(full_name)').order('updated_at', { ascending: false })),
      must(supabase.from('campaigns').select('template_id, name, is_active')),
      must(supabase.from('fee_reminders').select('kind, template_id, is_active')),
    ])
    const usedBy = (id) => [
      ...campaigns.filter((campaign) => campaign.template_id === id).map((campaign) => `${campaign.name} campaign`),
      ...reminders.filter((reminder) => reminder.template_id === id).map((reminder) => purposeLabel(reminder.kind) + ' reminder'),
    ]
    return { templates: templates.map((template) => ({ ...template, used_by: usedBy(template.id) })) }
  }, [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (data?.templates || []).filter((template) =>
      (purpose === 'all' || template.purpose === purpose) &&
      (!needle || [template.name, template.subject, template.body].join(' ').toLowerCase().includes(needle)))
  }, [data, purpose, query])

  const canEdit = (template) => isAdmin || template.created_by === user.id

  const remove = async (template) => {
    if (template.used_by.length) return toast(`In use by ${template.used_by.join(', ')}. Pick another template there first.`, 'error')
    if (!window.confirm(`Delete the template “${template.name}”?`)) return
    const { error: deleteError } = await supabase.from('message_templates').delete().eq('id', template.id)
    if (deleteError) return toast(deleteError.message, 'error')
    toast('Template deleted')
    reload()
  }

  return (
    <>
      <PageHead title="Message templates" sub="Write once, send to anyone. {{placeholders}} fill in each person’s details.">
        <button className="btn btn-primary" onClick={() => setEditing({ purpose: purpose === 'all' ? 'general' : purpose })}>
          <Icon name="plus" size={18} /> New template
        </button>
      </PageHead>

      <div className="toolbar">
        <Search value={query} onChange={setQuery} placeholder="Search templates" />
      </div>
      <div className="filters">
        {[{ key: 'all', label: 'All' }, ...PURPOSES].map((item) => (
          <button key={item.key} className={`chip ${purpose === item.key ? 'on' : ''}`} onClick={() => setPurpose(item.key)}>{item.label}</button>
        ))}
      </div>

      <ErrorNote>{error}</ErrorNote>
      {!data ? <Loading /> : visible.length === 0 ? (
        <Empty icon="template" title={data.templates.length ? 'No templates match' : 'No templates yet'}
          action={<button className="btn btn-primary" onClick={() => setEditing({ purpose: 'general' })}>Write a template</button>}>
          Templates are the words your campaigns, fee reminders and broadcasts send.
        </Empty>
      ) : (
        <div className="template-grid">
          {visible.map((template) => (
            <article key={template.id} className="panel template-card tilt">
              <header className="row spread">
                <span className={`purpose purpose-${template.purpose}`}>{purposeLabel(template.purpose)}</span>
                {canEdit(template) && (
                  <span className="row">
                    <button className="icon-btn icon-btn-sm" onClick={() => setEditing(template)} aria-label={`Edit ${template.name}`}><Icon name="note" size={16} /></button>
                    <button className="icon-btn icon-btn-sm" onClick={() => remove(template)} aria-label={`Delete ${template.name}`}><Icon name="trash" size={16} /></button>
                  </span>
                )}
              </header>
              <h3>{template.name}</h3>
              <div className="bubble"><p>{fillSample(template.body)}</p></div>
              <footer className="template-foot">
                {template.used_by.length > 0 && <span className="used-by"><Icon name="repeat" size={14} /> {template.used_by.join(' · ')}</span>}
                <small>{template.members?.full_name ? `${template.members.full_name} · ` : ''}edited {timeAgo(template.updated_at)}</small>
              </footer>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <TemplateForm template={editing} onClose={() => setEditing(null)}
          onSaved={(isNew) => { setEditing(null); toast(isNew ? 'Template saved' : 'Template updated'); reload() }} />
      )}
    </>
  )
}

export function TemplateForm({ template, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState({
    name: template.name || '',
    purpose: template.purpose || 'general',
    subject: template.subject || '',
    body: template.body || '',
  })
  const [preview, setPreview] = useState('whatsapp')
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef(null)
  const subjectRef = useRef(null)
  const lastFocus = useRef('body')

  const audience = PURPOSES.find((item) => item.key === form.purpose)?.for || 'any'
  const placeholders = PLACEHOLDERS.filter((item) => item.for === 'any' || item.for === audience || audience === 'any')

  const insert = (key) => {
    const field = lastFocus.current
    const element = field === 'subject' ? subjectRef.current : bodyRef.current
    const token = `{{${key}}}`
    const value = form[field]
    const start = element?.selectionStart ?? value.length
    const end = element?.selectionEnd ?? value.length
    setForm({ ...form, [field]: value.slice(0, start) + token + value.slice(end) })
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    const payload = { name: form.name.trim(), purpose: form.purpose, subject: form.subject.trim() || null, body: form.body.trim() }
    const { error } = template.id
      ? await supabase.from('message_templates').update(payload).eq('id', template.id)
      : await supabase.from('message_templates').insert(payload)
    setBusy(false)
    if (error) return toast(error.message, 'error')
    onSaved(!template.id)
  }

  return (
    <Modal title={template.id ? `Edit “${template.name}”` : 'New message template'} onClose={onClose} wide>
      <form className="form template-form" onSubmit={save}>
        <div className="template-editor">
          <div className="form">
            <div className="form-row">
              <Field label="Name"><input required autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Second follow-up" /></Field>
              <Field label="Used for">
                <select value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })}>
                  {PURPOSES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Email subject" hint="WhatsApp ignores the subject">
              <input ref={subjectRef} value={form.subject} onFocus={() => { lastFocus.current = 'subject' }}
                onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="e.g. Your seat for {{course}} is waiting" />
            </Field>
            <Field label="Message">
              <textarea ref={bodyRef} rows={10} required value={form.body} onFocus={() => { lastFocus.current = 'body' }}
                onChange={(event) => setForm({ ...form, body: event.target.value })}
                placeholder={'Hello {{first_name}},\n\n…'} />
            </Field>
            <div>
              <span className="field-label">Tap to insert</span>
              <div className="chips placeholder-chips">
                {placeholders.map((item) => (
                  <button type="button" key={item.key} className="chip chip-quiet" onClick={() => insert(item.key)} title={`{{${item.key}}}`}>{item.label}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="template-preview">
            <Segmented label="Preview" value={preview} onChange={setPreview}
              options={[{ value: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' }, { value: 'email', label: 'Email', icon: 'mail' }]} />
            {preview === 'whatsapp' ? (
              <div className="phone">
                <div className="phone-bar"><Icon name="whatsapp" size={16} /> TecTerminal Umuahia</div>
                <div className="phone-chat">
                  <div className="bubble bubble-out"><p>{fillSample(form.body) || 'Your message appears here.'}</p><small>9:41</small></div>
                </div>
              </div>
            ) : (
              <div className="mail-preview">
                <div className="mail-stripe" />
                <b className="mail-from">TecTerminal Umuahia</b>
                <h4>{fillSample(form.subject) || 'Subject line'}</h4>
                <p>{fillSample(form.body) || 'Your message appears here.'}</p>
                <small>Stop receiving these messages</small>
              </div>
            )}
            <p className="muted small">Preview uses sample details. Real messages use each person’s own.</p>
          </div>
        </div>
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save template'}</button>
        </div>
      </form>
    </Modal>
  )
}
