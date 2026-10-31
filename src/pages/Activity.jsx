import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { dayLabel, todayISO, addDaysISO } from '../lib/format'
import Icon from '../components/Icon'
import { Avatar, Empty, ErrorNote, Loading, PageHead, Search } from '../components/ui'

const TYPES = [
  { value: 'all', label: 'Everything' },
  { value: 'lead', label: 'Leads' },
  { value: 'student', label: 'Students' },
  { value: 'payment', label: 'Payments' },
  { value: 'member', label: 'Team' },
  { value: 'course', label: 'Courses' },
  { value: 'tiers', label: 'Commission' },
]
const ICONS = { lead: 'leads', student: 'students', payment: 'commission', member: 'team', course: 'courses', tiers: 'commission' }

const dayHeading = (iso) => {
  if (iso === todayISO()) return 'Today'
  if (iso === addDaysISO(-1)) return 'Yesterday'
  return dayLabel(iso)
}

export default function Activity() {
  const [type, setType] = useState('all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(150)

  const { data, error } = useLoad(async () => {
    let request = supabase.from('activity_log').select('*, members(full_name, email)').order('created_at', { ascending: false }).limit(limit)
    if (type !== 'all') request = request.eq('subject_type', type)
    return { entries: await must(request) }
  }, [type, limit])

  const days = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const groups = new Map()
    ;(data?.entries || [])
      .filter((entry) => !needle || `${entry.members?.full_name} ${entry.summary}`.toLowerCase().includes(needle))
      .forEach((entry) => {
        const local = new Date(entry.created_at)
        const key = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(entry)
      })
    return [...groups.entries()]
  }, [data, query])

  return (
    <>
      <PageHead title="Activity log" sub="Every change across the ledger, recorded by the database itself." />
      <div className="toolbar">
        <Search value={query} onChange={setQuery} placeholder="Search people or actions" />
      </div>
      <div className="filters">
        {TYPES.map((option) => (
          <button key={option.value} className={`chip ${type === option.value ? 'on' : ''}`} aria-pressed={type === option.value} onClick={() => setType(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!data ? <Loading rows={8} /> : days.length === 0 ? (
        <Empty icon="activity" title="Nothing logged yet">Changes appear here as the team works.</Empty>
      ) : (
        <div className="feed">
          {days.map(([day, entries]) => (
            <section key={day} className="feed-day">
              <h2 className="feed-heading">{dayHeading(day)}</h2>
              <ol>
                {entries.map((entry) => (
                  <li key={entry.id} className={`feed-item feed-${entry.action}`}>
                    <Avatar name={entry.members?.full_name || entry.members?.email || 'System'} size="sm" />
                    <p><b>{entry.members?.full_name || entry.members?.email || 'System'}</b> {entry.summary}</p>
                    <span className="feed-kind" title={entry.subject_type}><Icon name={ICONS[entry.subject_type] || 'activity'} size={15} /></span>
                    <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {data.entries.length === limit && <button className="btn btn-block" onClick={() => setLimit(limit + 150)}>Show older activity</button>}
        </div>
      )}
    </>
  )
}
