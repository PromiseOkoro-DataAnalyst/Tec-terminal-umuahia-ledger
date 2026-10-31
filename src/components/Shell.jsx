import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth'
import { getTheme, setTheme } from '../lib/theme'
import Icon from './Icon'
import { Avatar, Logo } from './ui'

const NAV = [
  [
    { to: '/', label: 'Today', icon: 'today', end: true },
    { to: '/leads', label: 'Leads', icon: 'leads' },
    { to: '/students', label: 'Students', icon: 'students' },
  ],
  [
    { to: '/commission', label: 'Commission', icon: 'commission' },
    { to: '/analytics', label: 'Analytics', icon: 'analytics' },
  ],
  [
    { to: '/outbox', label: 'Outbox', icon: 'outbox' },
    { to: '/templates', label: 'Templates', icon: 'template' },
    { to: '/automations', label: 'Automations', icon: 'repeat', admin: true },
    { to: '/broadcast', label: 'Broadcast', icon: 'megaphone', admin: true },
  ],
  [
    { to: '/courses', label: 'Courses', icon: 'courses', admin: true },
    { to: '/team', label: 'Team', icon: 'team', admin: true },
    { to: '/activity', label: 'Activity log', icon: 'activity', admin: true },
  ],
]

const readCollapsed = () => {
  try { return localStorage.getItem('tt-rail') === 'collapsed' } catch { return false }
}

export default function Shell() {
  const { member, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [theme, setThemeState] = useState(getTheme)
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => { setTheme(theme) }, [theme])
  // Glass cards glow under the pointer; cards marked .tilt lean toward it in 3D
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const fine = window.matchMedia('(pointer: fine)').matches
    let tilted = null
    const settle = (card) => {
      card.style.setProperty('--rx', '0deg')
      card.style.setProperty('--ry', '0deg')
      card.classList.remove('is-tilting')
    }
    const onMove = (event) => {
      const card = event.target.closest?.('.spot, .panel, .tile, .acard, .kpi, .outbox-row')
      if (tilted && tilted !== card) { settle(tilted); tilted = null }
      if (!card) return
      const box = card.getBoundingClientRect()
      const px = event.clientX - box.left
      const py = event.clientY - box.top
      card.style.setProperty('--mx', `${px}px`)
      card.style.setProperty('--my', `${py}px`)
      if (!reduce && fine && (card.classList.contains('tilt') || card.matches('.acard, .kpi'))) {
        const strength = box.width > 600 ? 2.5 : 6
        card.style.setProperty('--ry', `${((px / box.width) - 0.5) * strength}deg`)
        card.style.setProperty('--rx', `${(0.5 - (py / box.height)) * strength}deg`)
        card.classList.add('is-tilting')
        tilted = card
      }
    }
    const onLeave = () => { if (tilted) { settle(tilted); tilted = null } }
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
    }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('tt-rail', collapsed ? 'collapsed' : 'open') } catch { /* ignore */ }
  }, [collapsed])
  // Close the phone "More" sheet whenever the page changes
  const [lastPath, setLastPath] = useState(location.pathname)
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setMoreOpen(false)
  }

  const groups = NAV.map((group) => group.filter((item) => !item.admin || isAdmin)).filter((group) => group.length)
  const toggleTheme = () => setThemeState(theme === 'dark' ? 'light' : 'dark')
  const quickAdd = () => navigate('/leads', { state: { newLead: Date.now() } })

  return (
    <div className={`shell ${collapsed ? 'rail-collapsed' : ''}`}>
      <aside className="rail glass">
        <div className="rail-top">
          <Logo compact={collapsed} />
        </div>
        <nav className="rail-nav" aria-label="Main">
          {groups.map((group, index) => (
            <div className="rail-group" key={index}>
              {group.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} title={collapsed ? item.label : undefined}
                  className={({ isActive }) => `rail-link ${isActive ? 'active' : ''}`}>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="rail-foot">
          <NavLink to="/profile" className={({ isActive }) => `rail-me ${isActive ? 'active' : ''}`} title="My profile">
            <Avatar name={member?.full_name || member?.email} />
            <span className="rail-me-text">
              <b>{member?.full_name || member?.email}</b>
              <small>{isAdmin ? 'Admin' : 'Marketer'}</small>
            </span>
          </NavLink>
          <div className="rail-tools">
            <button className="icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
            <button className="icon-btn" onClick={signOut} aria-label="Sign out"><Icon name="logout" /></button>
            <button className="icon-btn" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}>
              <Icon name="sidebar" />
            </button>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar glass">
          <Logo />
          <NavLink to="/profile" className="topbar-me" aria-label="My profile">
            <Avatar name={member?.full_name || member?.email} size="sm" />
          </NavLink>
        </header>
        <main className="page" key={location.pathname}>
          <Outlet />
        </main>
      </div>

      <nav className="tabbar glass" aria-label="Main">
        <NavLink to="/" end className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}><Icon name="today" size={22} /><span>Today</span></NavLink>
        <NavLink to="/leads" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}><Icon name="leads" size={22} /><span>Leads</span></NavLink>
        <button className="tab-add" onClick={quickAdd} aria-label="Add a lead"><Icon name="plus" size={26} /></button>
        <NavLink to="/students" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}><Icon name="students" size={22} /><span>Students</span></NavLink>
        <button className={`tab ${moreOpen ? 'active' : ''}`} onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen}>
          <Icon name="grid" size={22} /><span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="scrim" onMouseDown={() => setMoreOpen(false)}>
          <div className="more-sheet glass" onMouseDown={(event) => event.stopPropagation()}>
            <div className="more-grid">
              {groups.flat().filter((item) => !['/', '/leads', '/students'].includes(item.to)).map((item) => (
                <NavLink key={item.to} to={item.to} className="more-item"><Icon name={item.icon} size={22} /><span>{item.label}</span></NavLink>
              ))}
              <NavLink to="/profile" className="more-item"><Icon name="profile" size={22} /><span>My profile</span></NavLink>
              <button className="more-item" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={22} /><span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span></button>
              <button className="more-item" onClick={signOut}><Icon name="logout" size={22} /><span>Sign out</span></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
