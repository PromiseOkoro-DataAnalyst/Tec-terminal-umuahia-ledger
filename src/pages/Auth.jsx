import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/auth'
import { SCENES } from '../lib/photos'
import Icon from '../components/Icon'
import { Field, Logo } from '../components/ui'

const friendly = (text = '') => {
  if (/invalid login/i.test(text)) return 'That email and password don’t match. Check both, or reset your password.'
  if (/email not confirmed/i.test(text)) return 'Confirm your email first — open the link we sent to your inbox.'
  if (/already registered/i.test(text)) return 'That email already has an account. Sign in instead.'
  if (/rate limit/i.test(text)) return 'Too many attempts. Wait a minute, then try again.'
  if (/password should be/i.test(text)) return 'Use a password of at least 6 characters.'
  return text
}

// Decorative photo that quietly disappears if it can't load (the gradient behind shows instead)
function Photo({ photo, className }) {
  const [failed, setFailed] = useState(false)
  return (
    <figure className={`auth-photo ${className}`}>
      {!failed && <img src={photo.src} alt="" loading="eager" decoding="async" onError={() => setFailed(true)} />}
    </figure>
  )
}

// Split screen: a layered photo collage with floating glass cards on the left, the form on the right.
// The collage leans toward the pointer in 3D.
function AuthScene({ scene = 'signin', children }) {
  const { main, small } = SCENES[scene]
  const lean = (event) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const box = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty('--px', ((event.clientX - box.left) / box.width - 0.5).toFixed(3))
    event.currentTarget.style.setProperty('--py', ((event.clientY - box.top) / box.height - 0.5).toFixed(3))
  }
  const credits = [main, ...small].filter((photo, index, list) => list.indexOf(photo) === index)
  return (
    <div className="auth">
      <section className="auth-art" onPointerMove={lean} onPointerLeave={(event) => { event.currentTarget.style.setProperty('--px', 0); event.currentTarget.style.setProperty('--py', 0) }}>
        <div className="auth-stage">
          <Photo photo={main} className="auth-photo-main" />
          <Photo photo={small[0]} className="auth-photo-a" />
          <Photo photo={small[1]} className="auth-photo-b" />
          <div className="float-card float-1 glass" aria-hidden="true">
            <span className="float-icon money"><Icon name="check" size={16} /></span>
            <span><b>₦150,000 recorded</b><small>Data Analytics · just now</small></span>
          </div>
          <div className="float-card float-2 glass" aria-hidden="true">
            <span className="float-ring"><i /></span>
            <span><b>7% tier reached</b><small>₦360k to the next rate</small></span>
          </div>
          <div className="float-card float-3 glass" aria-hidden="true">
            <span className="float-icon lead"><Icon name="leads" size={16} /></span>
            <span><b>New lead</b><small>Booked a campus visit</small></span>
          </div>
        </div>
        <div className="auth-art-copy">
          <p className="auth-motto">Learn. Connect. Succeed.</p>
          <p className="auth-art-sub">Every lead, student and naira at TecTerminal Umuahia, in one ledger.</p>
        </div>
        <p className="photo-credit">
          Photos: {credits.map((photo, index) => (
            <span key={photo.link}>{index > 0 && ', '}<a href={photo.link} target="_blank" rel="noreferrer">{photo.credit}</a></span>
          ))} / Unsplash
        </p>
      </section>
      <section className="auth-side">
        <div className="auth-card glass">{children}</div>
      </section>
    </div>
  )
}

// One card, two forms. A slanted panel ("the blade") sits over whichever form
// isn't in use. Switching between Sign in and Create account sweeps it across.
function LineField({ label, icon, children, action }) {
  return (
    <label className="line-field">
      <span className="line-label">{label}</span>
      <span className="line-input">
        {children}
        {action || (icon && <Icon name={icon} size={17} />)}
      </span>
    </label>
  )
}

export function Login() {
  const [mode, setMode] = useState('signin')
  const [sweep, setSweep] = useState('')
  const [form, setForm] = useState({ email: '', password: '', full_name: '', whatsapp: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value })
  const side = mode === 'signup' ? 'signup' : 'signin'

  const switchTo = (next) => {
    const nextSide = next === 'signup' ? 'signup' : 'signin'
    if (nextSide !== side) setSweep(nextSide === 'signup' ? 'to-signup' : 'to-signin')
    setMode(next)
    setMessage(null)
    setShowPassword(false)
  }

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    let result
    if (mode === 'signin') {
      result = await supabase.auth.signInWithPassword({ email: form.email, password: form.password })
    } else if (mode === 'signup') {
      result = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: { data: { full_name: form.full_name.trim(), whatsapp: form.whatsapp.trim() }, emailRedirectTo: window.location.origin },
      })
      if (!result.error) {
        setMessage({ tone: 'ok', text: result.data.session
          ? 'Account created. An admin will activate it shortly.'
          : 'Check your inbox and confirm your email. Then sign in — an admin will activate your account.' })
      }
    } else {
      result = await supabase.auth.resetPasswordForEmail(form.email, { redirectTo: window.location.origin })
      if (!result.error) setMessage({ tone: 'ok', text: 'If that email has an account, a reset link is on its way.' })
    }
    if (result.error) setMessage({ tone: 'error', text: friendly(result.error.message) })
    setBusy(false)
  }

  const eye = (
    <button type="button" className="line-eye" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
      <Icon name={showPassword ? 'eyeOff' : 'eye'} size={17} />
    </button>
  )
  const photo = SCENES.signin.main

  return (
    <div className="blade-page">
      <div className={`blade-card side-${side}`}>
        <section className="blade-pane pane-signin" inert={side !== 'signin'} aria-hidden={side !== 'signin'}>
          <Logo />
          <header className="pane-title">
            <h1>{mode === 'reset' ? 'Reset password' : 'Sign in'}</h1>
            <p>{mode === 'reset' ? 'We’ll email you a link to choose a new one.' : 'Pick up today’s follow-ups where you left them.'}</p>
          </header>
          <form className="line-form" onSubmit={submit}>
            <LineField label="Email address" icon="mail">
              <input type="email" required value={form.email} onChange={update('email')} autoComplete="email" />
            </LineField>
            {mode === 'signin' && (
              <LineField label="Password" action={eye}>
                <input type={showPassword ? 'text' : 'password'} required minLength={6} value={form.password} onChange={update('password')} autoComplete="current-password" />
              </LineField>
            )}
            {mode === 'signin' && (
              <div className="line-row">
                <span className="muted small">Stays signed in on this device</span>
                <button type="button" className="line-link" onClick={() => switchTo('reset')}>Forgot password?</button>
              </div>
            )}
            {side === 'signin' && message && <p className={`note note-${message.tone}`} role="status">{message.text}</p>}
            <button className="btn btn-primary btn-lg blade-submit" disabled={busy}>
              {busy ? 'One moment…' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
            </button>
          </form>
          <p className="pane-switch">
            {mode === 'reset'
              ? <button type="button" className="line-link" onClick={() => switchTo('signin')}>Back to sign in</button>
              : <>New marketer? <button type="button" className="line-link" onClick={() => switchTo('signup')}>Create an account</button></>}
          </p>
        </section>

        <section className="blade-pane pane-signup" inert={side !== 'signup'} aria-hidden={side !== 'signup'}>
          <header className="pane-title">
            <h1>Create account</h1>
            <p>Marketers register here. An admin activates each account.</p>
          </header>
          <form className="line-form" onSubmit={submit}>
            <LineField label="Full name" icon="profile">
              <input required value={form.full_name} onChange={update('full_name')} autoComplete="name" />
            </LineField>
            <LineField label="WhatsApp number" icon="whatsapp">
              <input required value={form.whatsapp} onChange={update('whatsapp')} inputMode="tel" autoComplete="tel" placeholder="0803 000 0000" />
            </LineField>
            <LineField label="Email address" icon="mail">
              <input type="email" required value={form.email} onChange={update('email')} autoComplete="email" />
            </LineField>
            <LineField label="Password" action={eye}>
              <input type={showPassword ? 'text' : 'password'} required minLength={6} value={form.password} onChange={update('password')} autoComplete="new-password" />
            </LineField>
            <small className="line-hint">Use 6 characters or more.</small>
            {side === 'signup' && message && <p className={`note note-${message.tone}`} role="status">{message.text}</p>}
            <button className="btn btn-primary btn-lg blade-submit" disabled={busy}>{busy ? 'One moment…' : 'Create account'}</button>
          </form>
          <p className="pane-switch">Already have an account? <button type="button" className="line-link" onClick={() => switchTo('signin')}>Sign in</button></p>
        </section>

        <div className={`blade ${sweep}`} aria-hidden="true">
          <div className="blade-shape">
            <img src={photo.src} alt="" className="blade-photo" onError={(event) => { event.currentTarget.style.display = 'none' }} />
          </div>
          <div className="blade-copy copy-signin">
            <span className="blade-eyebrow">TecTerminal Umuahia</span>
            <h2>Welcome <em>back.</em></h2>
            <p>Your leads, students and payments are exactly where you left them.</p>
          </div>
          <div className="blade-copy copy-signup">
            <span className="blade-eyebrow">TecTerminal Umuahia</span>
            <h2>Start your <em>first page.</em></h2>
            <p>One account for every lead you bring in, every student you enrol and every naira you collect.</p>
          </div>
        </div>
      </div>
      <p className="blade-credit">Learn. Connect. Succeed. · Photo: <a href={photo.link} target="_blank" rel="noreferrer">{photo.credit}</a> / Unsplash</p>
    </div>
  )
}

export function SetPassword() {
  const { finishRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setMessage({ tone: 'error', text: friendly(error.message) })
    else finishRecovery()
  }

  return (
    <AuthScene scene="reset">
      <Logo tagline />
      <div className="auth-title">
        <h1>Choose a new password</h1>
        <p className="muted">You’ll use it the next time you sign in.</p>
      </div>
      <form className="form" onSubmit={save}>
        <Field label="New password"><input type="password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></Field>
        {message && <p className={`note note-${message.tone}`}>{message.text}</p>}
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </AuthScene>
  )
}

export function Pending() {
  const { member, refreshMember, signOut } = useAuth()
  const suspended = member?.status === 'suspended'
  return (
    <AuthScene scene="pending">
      <Logo tagline />
      <div className="auth-title">
        <h1>{suspended ? 'Access paused' : 'Almost there'}</h1>
        <p className="muted">
          {suspended
            ? 'An admin has paused this account. Ask them to switch it back on.'
            : `${member?.full_name || member?.email || 'Your account'} is registered. An admin needs to activate it before you can see leads and students.`}
        </p>
      </div>
      <div className="row">
        <button className="btn btn-primary" onClick={refreshMember}>Check again</button>
        <button className="btn" onClick={signOut}>Sign out</button>
      </div>
    </AuthScene>
  )
}

export function NotConfigured() {
  return (
    <div className="center-screen">
      <Logo />
      <h1>Connect Supabase</h1>
      <p className="muted">
        Create a file called <code>.env</code> in the project folder with your <code>VITE_SUPABASE_URL</code> and{' '}
        <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> (see <code>.env.example</code>), then restart <code>npm run dev</code>.
        On Vercel, add the same two values under Project Settings → Environment Variables and redeploy.
      </p>
    </div>
  )
}

export function Splash() {
  return <div className="center-screen"><span className="spinner" aria-label="Loading" /></div>
}
