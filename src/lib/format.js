const nairaFormat = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })

export const naira = (value) => nairaFormat.format(Number(value || 0))

// ₦1.2m / ₦640k for tight spaces like chart labels
export const nairaShort = (value) => {
  const amount = Number(value || 0)
  if (amount >= 1_000_000) return `₦${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}m`
  if (amount >= 1_000) return `₦${Math.round(amount / 1_000)}k`
  return `₦${amount}`
}

export const todayISO = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export const addDaysISO = (days, from = todayISO()) => {
  const date = new Date(`${from}T12:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export const monthStartISO = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`

export const dayLabel = (value) =>
  value ? new Date(String(value).length === 10 ? `${value}T12:00:00` : value)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export const shortDay = (value) =>
  value ? new Date(String(value).length === 10 ? `${value}T12:00:00` : value)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'

export const monthName = (value) =>
  new Date(String(value).length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('en-GB', { month: 'long' })

export const monthLabel = (value) =>
  new Date(String(value).length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

export const timeAgo = (value) => {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} d ago`
  return dayLabel(value)
}

// "Due today", "Overdue 3 days", "In 2 days"
export const followUpLabel = (dateISO) => {
  if (!dateISO) return null
  const today = new Date(`${todayISO()}T12:00:00`)
  const due = new Date(`${dateISO}T12:00:00`)
  const days = Math.round((due - today) / 86400000)
  if (days === 0) return { text: 'Due today', tone: 'due' }
  if (days < 0) return { text: `Overdue ${-days} d`, tone: 'overdue' }
  if (days === 1) return { text: 'Tomorrow', tone: 'soon' }
  return { text: `In ${days} days`, tone: 'later' }
}

export const initials = (name = '') =>
  name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '?'

// WhatsApp link from a Nigerian number like 0803 123 4567
export const whatsappLink = (number, text) => {
  const digits = String(number || '').replace(/\D/g, '')
  const international = digits.startsWith('0') ? `234${digits.slice(1)}` : digits
  return `https://wa.me/${international}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

// Which commission tier a monthly total falls into, and the next one up
export const tierFor = (tiers, total) => {
  const sorted = [...tiers].sort((a, b) => a.lower_bound - b.lower_bound)
  const index = sorted.findIndex((tier) =>
    total >= Number(tier.lower_bound) && (tier.upper_bound == null || total <= Number(tier.upper_bound)))
  return {
    sorted,
    current: index >= 0 ? sorted[index] : null,
    next: index >= 0 ? sorted[index + 1] || null : sorted[0] || null,
  }
}

export const STAGES = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'interested', label: 'Interested' },
  { key: 'visited', label: 'Visited' },
  { key: 'enrolled', label: 'Enrolled' },
  { key: 'lost', label: 'Lost' },
]
export const stageLabel = (key) => STAGES.find((stage) => stage.key === key)?.label || key
