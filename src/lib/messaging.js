import { supabase } from './supabase'

export const PURPOSES = [
  { key: 'lead_follow_up', label: 'Lead follow-up', hint: 'Sent to leads again and again until they enrol', for: 'lead' },
  { key: 'fee_upcoming', label: 'Fee coming up', hint: 'Sent to students a few days before a payment is due', for: 'student' },
  { key: 'fee_overdue', label: 'Fee overdue', hint: 'Sent to students when a payment date has passed', for: 'student' },
  { key: 'broadcast', label: 'Broadcast', hint: 'One-off announcements to many people', for: 'any' },
  { key: 'general', label: 'General', hint: 'Anything else you send by hand', for: 'any' },
]
export const purposeLabel = (key) => PURPOSES.find((purpose) => purpose.key === key)?.label || key

export const SOURCES = {
  campaign: 'Campaign',
  fee_upcoming: 'Fee coming up',
  fee_overdue: 'Fee overdue',
  broadcast: 'Broadcast',
  manual: 'Sent by hand',
}

export const CHANNELS = [
  { value: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' },
  { value: 'email', label: 'Email', icon: 'mail' },
]

// What {{placeholders}} mean, and what they look like in the preview
export const PLACEHOLDERS = [
  { key: 'first_name', label: 'First name', sample: 'Chioma', for: 'any' },
  { key: 'full_name', label: 'Full name', sample: 'Chioma Okafor', for: 'any' },
  { key: 'course', label: 'Course', sample: 'Software Engineering', for: 'any' },
  { key: 'course_fee', label: 'Course fee', sample: '₦350,000', for: 'any' },
  { key: 'marketer_name', label: 'Marketer name', sample: 'Ada Nwosu', for: 'any' },
  { key: 'marketer_whatsapp', label: 'Marketer WhatsApp', sample: '0803 123 4567', for: 'any' },
  { key: 'balance', label: 'Balance', sample: '₦150,000', for: 'student' },
  { key: 'amount_paid', label: 'Amount paid', sample: '₦200,000', for: 'student' },
  { key: 'amount_due', label: 'Amount due', sample: '₦50,000', for: 'student' },
  { key: 'due_date', label: 'Due date', sample: '3 Nov 2026', for: 'student' },
  { key: 'days_overdue', label: 'Days overdue', sample: '4', for: 'student' },
  { key: 'opt_out_link', label: 'Unsubscribe link', sample: 'https://…/unsubscribe', for: 'any' },
]

export const fillSample = (text = '') =>
  PLACEHOLDERS.reduce((result, item) => result.replaceAll(`{{${item.key}}}`, item.sample), text || '')
    .replace(/\{\{\s*[a-z_]+\s*\}\}/g, '')

export const mediaUrl = (path) => supabase.storage.from('broadcast-media').getPublicUrl(path).data.publicUrl

export const mediaName = (path) => decodeURIComponent(String(path).split('/').pop()).replace(/^\d+-/, '')

// Calls the send-messages Edge Function as the signed-in admin
export async function callSender(body = {}) {
  const { data, error } = await supabase.functions.invoke('send-messages', { body })
  if (error) {
    let message = error.message
    try {
      const detail = await error.context?.json?.()
      if (detail?.error) message = detail.error
    } catch { /* keep the generic message */ }
    if (/Failed to send a request|FunctionsFetchError|not found/i.test(message)) {
      message = 'The send-messages function isn’t deployed yet. See “Turn on sending” in the README.'
    }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}
