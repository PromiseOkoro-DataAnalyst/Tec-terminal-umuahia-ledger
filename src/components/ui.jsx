import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { followUpLabel, initials, stageLabel } from '../lib/format'

// The TecTerminal mark (public/logo-mark.png) with the wordmark set in type,
// so it stays crisp and readable in both light and dark themes.
export function Logo({ compact = false, tagline = false }) {
  return (
    <span className={`logo ${tagline ? 'logo-lockup' : ''}`}>
      <img className="logo-mark" src="/logo-mark.png" alt={compact ? 'TecTerminal' : ''} width="40" height="40" />
      {!compact && (
        <span className="logo-words">
          <b>TecTerminal</b>
          <small>{tagline ? 'Learn. Connect. Succeed.' : 'Umuahia Ledger'}</small>
        </span>
      )}
    </span>
  )
}

export function PageHead({ title, sub, children }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  )
}

function useEscape(onClose) {
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])
}

// Slides in from the right on desktop, up from the bottom on phones
export function Drawer({ title, sub, onClose, children, footer }) {
  useEscape(onClose)
  return (
    <div className="scrim" onMouseDown={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <h2>{title}</h2>
            {sub && <p className="muted">{sub}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </div>
  )
}

export function Modal({ title, onClose, children, wide = false }) {
  useEscape(onClose)
  return (
    <div className="scrim scrim-center" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, hint, children, wide = false }) {
  return (
    <label className={`field ${wide ? 'field-wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  )
}

export function Empty({ icon = 'leads', title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={26} /></span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function StagePill({ stage }) {
  return <span className={`stage stage-${stage}`}><i aria-hidden="true" />{stageLabel(stage)}</span>
}

export function FollowUpChip({ date }) {
  const label = followUpLabel(date)
  if (!label) return null
  return <span className={`due due-${label.tone}`}><Icon name="calendar" size={13} />{label.text}</span>
}

export function Avatar({ name, size = 'md' }) {
  return <span className={`avatar avatar-${size}`} aria-hidden="true">{initials(name)}</span>
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value}
          className={value === option.value ? 'on' : ''} onClick={() => onChange(option.value)}>
          {option.icon && <Icon name={option.icon} size={16} />}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Search({ value, onChange, placeholder }) {
  return (
    <label className="search">
      <Icon name="search" size={18} />
      <input type="search" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

export function Loading({ rows = 4 }) {
  return (
    <div className="skeletons" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => <span key={index} className="skeleton" style={{ animationDelay: `${index * 90}ms` }} />)}
    </div>
  )
}

export function ErrorNote({ children }) {
  return children ? <p className="note note-error" role="alert">{children}</p> : null
}

// Counts up to a number once, on first render (skipped when reduced motion is on)
export function CountUp({ value, format = (number) => number }) {
  const [shown, setShown] = useState(0)
  const done = useRef(false)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || done.current) {
      const frame = requestAnimationFrame(() => setShown(value))
      return () => cancelAnimationFrame(frame)
    }
    done.current = true
    const start = performance.now()
    let frame
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / 900)
      setShown(value * (1 - Math.pow(1 - progress, 3)))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return <>{format(Math.round(shown))}</>
}

// Wide photo strip with a line of copy on glass; the photo hides itself if it can't load
export function PhotoBanner({ photo, title, children }) {
  const [failed, setFailed] = useState(false)
  return (
    <section className="photo-banner tilt">
      {!failed && <img src={photo.src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />}
      <div className="photo-banner-copy glass">
        <b>{title}</b>
        {children && <span>{children}</span>}
      </div>
      <a className="photo-banner-credit" href={photo.link} target="_blank" rel="noreferrer">Photo: {photo.credit} / Unsplash</a>
    </section>
  )
}
