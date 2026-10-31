import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Logo } from '../components/ui'

// Public page behind the "Stop receiving these messages" link. No sign-in needed.
export default function Unsubscribe() {
  const token = new URLSearchParams(window.location.search).get('t') || ''
  const valid = /^[0-9a-f-]{36}$/i.test(token)
  const [state, setState] = useState(valid ? 'ready' : 'invalid')
  const [name, setName] = useState('')

  useEffect(() => { document.title = 'Unsubscribe · TecTerminal Umuahia' }, [])

  const confirm = async () => {
    setState('working')
    const { data, error } = await supabase.rpc('opt_out', { token })
    if (error || !data) return setState('invalid')
    setName(data)
    setState('done')
  }

  return (
    <div className="center-screen unsubscribe">
      <Logo tagline />
      {state === 'done' ? (
        <>
          <h1>You’re unsubscribed</h1>
          <p className="muted">{name ? `Thanks, ${name}. ` : ''}TecTerminal Umuahia won’t send you any more reminders or offers. If this was a mistake, just reply to any of our messages or call the centre.</p>
        </>
      ) : state === 'invalid' ? (
        <>
          <h1>This link doesn’t work</h1>
          <p className="muted">It may be incomplete. Reply to the message you received with “STOP” and we’ll remove you by hand.</p>
        </>
      ) : (
        <>
          <h1>Stop receiving messages?</h1>
          <p className="muted">You’ll no longer get follow-ups, reminders or announcements from TecTerminal Umuahia by email or WhatsApp.</p>
          <button className="btn btn-primary btn-lg" onClick={confirm} disabled={state === 'working'}>{state === 'working' ? 'One moment…' : 'Yes, unsubscribe me'}</button>
        </>
      )}
    </div>
  )
}
