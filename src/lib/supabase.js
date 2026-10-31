import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabaseConfigured = Boolean(url && key && !url.includes('your-project-ref'))

// Only the publishable key ever reaches the browser. Never put a secret / service-role key here.
export const supabase = supabaseConfigured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null

// Record an event the database can't see by itself (exports, downloads). Never blocks the UI.
export const logEvent = (action, subjectType, summary) =>
  supabase.rpc('log_event', { event_action: action, event_subject_type: subjectType, event_summary: summary })
    .then(() => {}, () => {})
