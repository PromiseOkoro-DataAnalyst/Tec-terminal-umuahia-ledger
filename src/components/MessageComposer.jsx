import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { useToast } from './toast'
import { whatsappLink } from '../lib/format'
import { CHANNELS, PURPOSES, purposeLabel } from '../lib/messaging'
import Icon from './Icon'
import { ErrorNote, Field, Loading, Modal, Segmented } from './ui'

// Pick a template, see it filled in for this person, tweak it, send.
// person: { kind: 'lead' | 'student', id, name, whatsapp, email }
export default function MessageComposer({ person, onClose, onSent }) {
  const toast = useToast()
  const [channel, setChannel] = useState(person.whatsapp ? 'whatsapp' : 'email')
  const [chosenId, setChosenId] = useState('')
  const [draft, setDraft] = useState({ forId: null, subject: '', body: '' })
  const [busy, setBusy] = useState(false)

  const { data, error } = useLoad(async () => {
    const [templates, settings] = await Promise.all([
      must(supabase.from('message_templates').select('id, name, purpose').order('name')),
      must(supabase.from('messaging_settings').select('whatsapp_mode').maybeSingle()),
    ])
    const fits = (template) => {
      const target = PURPOSES.find((purpose) => purpose.key === template.purpose)?.for
      return target === 'any' || target === person.kind
    }
    return { templates: templates.filter(fits), manualWhatsApp: (settings?.whatsapp_mode || 'manual') === 'manual' }
  }, [person.kind])

  // Start on the most fitting template
  const preferred = person.kind === 'lead' ? ['lead_follow_up'] : ['fee_overdue', 'fee_upcoming']
  const templateId = chosenId || (data?.templates.find((template) => preferred.includes(template.purpose)) || data?.templates[0])?.id || ''
  const previewing = Boolean(templateId) && draft.forId !== templateId

  // Fill the template in for this person
  useEffect(() => {
    if (!templateId) return
    let alive = true
    supabase.rpc('preview_message', {
      target_template_id: templateId,
      target_lead_id: person.kind === 'lead' ? person.id : null,
      target_student_id: person.kind === 'student' ? person.id : null,
    }).then(({ data: rows, error: previewError }) => {
      if (!alive) return
      if (previewError) toast(previewError.message, 'error')
      setDraft({ forId: templateId, subject: rows?.[0]?.subject || '', body: rows?.[0]?.body || '' })
    })
    return () => { alive = false }
  }, [templateId, person.id, person.kind, toast])

  const address = channel === 'whatsapp' ? person.whatsapp : person.email
  const opensWhatsApp = channel === 'whatsapp' && data?.manualWhatsApp

  const send = async (event) => {
    event.preventDefault()
    // Open the WhatsApp tab straight away so the browser doesn't block it as a pop-up
    const whatsappTab = opensWhatsApp ? window.open('', '_blank') : null
    setBusy(true)
    const { error: sendError } = await supabase.rpc('send_one_message', {
      target_template_id: templateId,
      target_channel: channel,
      target_lead_id: person.kind === 'lead' ? person.id : null,
      target_student_id: person.kind === 'student' ? person.id : null,
      custom_subject: draft.subject,
      custom_body: draft.body,
    })
    setBusy(false)
    if (sendError) {
      whatsappTab?.close()
      return toast(sendError.message, 'error')
    }
    if (whatsappTab) whatsappTab.location.href = whatsappLink(person.whatsapp, draft.body)
    toast(opensWhatsApp ? 'WhatsApp opened with your message' : channel === 'email' ? 'Email queued — it goes out within 10 minutes' : 'WhatsApp message queued')
    onSent?.()
    onClose()
  }

  return (
    <Modal title={`Message ${person.name.split(' ')[0]}`} onClose={onClose}>
      <ErrorNote>{error}</ErrorNote>
      {!data ? <Loading rows={3} /> : data.templates.length === 0 ? (
        <p className="muted">There are no templates yet. Add one on the Templates page first.</p>
      ) : (
        <form className="form" onSubmit={send}>
          <Segmented label="Send by" value={channel} onChange={setChannel}
            options={CHANNELS.map((option) => ({ ...option, label: option.label }))} />
          {!address && <p className="note note-error">No {channel === 'email' ? 'email address' : 'WhatsApp number'} on record for {person.name}.</p>}
          <Field label="Template">
            <select value={templateId} onChange={(event) => setChosenId(event.target.value)}>
              {data.templates.map((template) => (
                <option key={template.id} value={template.id}>{template.name} · {purposeLabel(template.purpose)}</option>
              ))}
            </select>
          </Field>
          {channel === 'email' && (
            <Field label="Subject"><input value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} required /></Field>
          )}
          <Field label="Message" hint="Filled in for this person. Edit it freely — the template itself doesn’t change.">
            <textarea rows={9} value={previewing ? 'Filling in…' : draft.body} disabled={previewing}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })} required />
          </Field>
          <div className="row end">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className={`btn ${opensWhatsApp ? 'btn-whatsapp' : 'btn-primary'}`} disabled={busy || previewing || !address}>
              <Icon name={channel === 'whatsapp' ? 'whatsapp' : 'send'} size={18} />
              {busy ? 'Sending…' : opensWhatsApp ? 'Open in WhatsApp' : channel === 'email' ? 'Send email' : 'Send WhatsApp'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
