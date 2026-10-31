import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './context/auth'
import Shell from './components/Shell'
import { Login, Pending, SetPassword, Splash } from './pages/Auth'
import Today from './pages/Today'
import Leads from './pages/Leads'
import Students from './pages/Students'
import Courses from './pages/Courses'
import Commission from './pages/Commission'
import Analytics from './pages/Analytics'
import Team from './pages/Team'
import Activity from './pages/Activity'
import Profile from './pages/Profile'
import Outbox from './pages/Outbox'
import Templates from './pages/Templates'
import Automations from './pages/Automations'
import Broadcast from './pages/Broadcast'
import Unsubscribe from './pages/Unsubscribe'

export default function App() {
  const { ready, user, member, isAdmin, recovering } = useAuth()
  const location = useLocation()

  // Public page for the unsubscribe link in messages
  if (location.pathname === '/unsubscribe') return <Unsubscribe />
  if (!ready) return <Splash />
  if (recovering && user) return <SetPassword />
  if (!user) return <Login />
  if (!member) return <Splash />
  if (member.status !== 'active') return <Pending />

  const adminOnly = (element) => (isAdmin ? element : <Navigate to="/" replace />)

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Today />} />
        <Route path="leads" element={<Leads />} />
        <Route path="students" element={<Students />} />
        <Route path="commission" element={<Commission />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="courses" element={adminOnly(<Courses />)} />
        <Route path="team" element={adminOnly(<Team />)} />
        <Route path="activity" element={adminOnly(<Activity />)} />
        <Route path="outbox" element={<Outbox />} />
        <Route path="templates" element={<Templates />} />
        <Route path="automations" element={adminOnly(<Automations />)} />
        <Route path="broadcast" element={adminOnly(<Broadcast />)} />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
