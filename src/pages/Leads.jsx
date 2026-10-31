import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { useAuth } from '../context/auth'
import { useToast } from '../components/toast'
import { STAGES, dayLabel, stageLabel, todayISO, whatsappLink } from '../lib/format'
import { exportToExcel } from '../lib/exportExcel'
import LeadDrawer from '../components/LeadDrawer'
import Icon from '../components/Icon'
import { Empty, ErrorNote, FollowUpChip, Loading, PageHead, Search, Segmented, StagePill } from '../components/ui'

const readView = () => {
  try { return localStorage.getItem('tt-leads-view') || 'board' } catch { return 'board' }
}

export default function Leads() {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const [view, setView] = useState(readView)
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('all')
  const [owner, setOwner] = useState('all')
  const [dueOnly, setDueOnly] = useState(false)
  const [open, setOpen] = useState(undefined)   // undefined = closed, null = new lead, id = existing
  const [dragging, setDragging] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)

  const { data, error, reload } = useLoad(async () => ({
    leads: await must(supabase.from('leads').select('*, courses(name), members(full_name)').order('created_at', { ascending: false })),
  }), [])

  useEffect(() => {
    try { localStorage.setItem('tt-leads-view', view) } catch { /* ignore */ }
  }, [view])

  // The phone "+" button and other pages can ask for a new-lead form
  const newLeadRequest = location.state?.newLead
  const [handledRequest, setHandledRequest] = useState(null)
  if (newLeadRequest && newLeadRequest !== handledRequest) {
    setHandledRequest(newLeadRequest)
    setOpen(null)
  }
  useEffect(() => {
    if (newLeadRequest) navigate('.', { replace: true, state: null })
  }, [newLeadRequest, navigate])

  const leads = useMemo(() => data?.leads || [], [data])
  const owners = useMemo(() => {
    const seen = new Map()
    leads.forEach((lead) => seen.set(lead.owner_id, lead.members?.full_name || 'Unnamed'))
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [leads])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return leads.filter((lead) =>
      (view === 'board' || stage === 'all' || lead.stage === stage) &&
      (owner === 'all' || lead.owner_id === owner) &&
      (!dueOnly || (lead.next_follow_up_on && lead.next_follow_up_on <= todayISO() && !['enrolled', 'lost'].includes(lead.stage))) &&
      (!needle || [lead.full_name, lead.whatsapp, lead.email, lead.courses?.name, lead.source].join(' ').toLowerCase().includes(needle)))
  }, [leads, query, stage, owner, dueOnly, view])

  const moveTo = async (leadId, nextStage) => {
    const lead = leads.find((item) => item.id === leadId)
    if (!lead || lead.stage === nextStage) return
    if (nextStage === 'enrolled') {
      setOpen(leadId)
      return toast('Use Enrol in the lead to create the student and first payment')
    }
    const { error: saveError } = await supabase.from('leads').update({ stage: nextStage }).eq('id', leadId)
    if (saveError) return toast(saveError.message, 'error')
    toast(`${lead.full_name.split(' ')[0]} moved to ${stageLabel(nextStage)}`)
    reload()
  }

  const exportLeads = () => exportToExcel({
    fileName: `TecTerminal leads ${todayISO()}`,
    sheet: 'Leads',
    subject: 'lead',
    rows: visible,
    columns: [
      { header: 'Name', value: (lead) => lead.full_name, width: 26 },
      { header: 'WhatsApp', value: (lead) => lead.whatsapp, width: 16 },
      { header: 'Email', value: (lead) => lead.email, width: 26 },
      { header: 'Course interest', value: (lead) => lead.courses?.name, width: 22 },
      { header: 'Source', value: (lead) => lead.source },
      { header: 'Stage', value: (lead) => stageLabel(lead.stage), width: 12 },
      { header: 'Next follow-up', value: (lead) => lead.next_follow_up_on ? new Date(`${lead.next_follow_up_on}T12:00:00`) : null, width: 14 },
      { header: 'Marketer', value: (lead) => lead.members?.full_name, width: 20 },
      { header: 'Added', value: (lead) => new Date(lead.created_at), width: 14 },
      { header: 'Opted out', value: (lead) => (lead.opted_out ? 'Yes' : 'No'), width: 10 },
      { header: 'Notes', value: (lead) => lead.notes, width: 40 },
    ],
  }).catch((exportError) => toast(exportError.message, 'error'))

  return (
    <>
      <PageHead title="Leads" sub={data ? `${leads.length} ${isAdmin ? 'across the team' : 'in your pipeline'}` : ' '}>
        <button className="btn" onClick={exportLeads} disabled={!visible.length}><Icon name="download" size={18} /> Excel</button>
        <button className="btn btn-primary" onClick={() => setOpen(null)}><Icon name="plus" size={18} /> Add lead</button>
      </PageHead>

      <div className="toolbar">
        <Search value={query} onChange={setQuery} placeholder="Search name, phone, course or source" />
        <Segmented label="View" value={view} onChange={setView}
          options={[{ value: 'board', label: 'Board', icon: 'board' }, { value: 'list', label: 'List', icon: 'list' }]} />
      </div>
      <div className="filters">
        <button className={`chip ${dueOnly ? 'on' : ''}`} aria-pressed={dueOnly} onClick={() => setDueOnly(!dueOnly)}>
          <Icon name="calendar" size={14} /> Due for follow-up
        </button>
        {view === 'list' && (
          <select className="chip-select" value={stage} onChange={(event) => setStage(event.target.value)} aria-label="Stage">
            <option value="all">All stages</option>
            {STAGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        )}
        {isAdmin && owners.length > 1 && (
          <select className="chip-select" value={owner} onChange={(event) => setOwner(event.target.value)} aria-label="Marketer">
            <option value="all">All marketers</option>
            {owners.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        )}
      </div>

      <ErrorNote>{error}</ErrorNote>
      {!data ? <Loading rows={6} /> : leads.length === 0 ? (
        <Empty title="No leads yet" action={<button className="btn btn-primary" onClick={() => setOpen(null)}>Add your first lead</button>}>
          Every enquiry — walk-in, call or DM — goes here so you can follow it up.
        </Empty>
      ) : view === 'board' ? (
        <div className="board" aria-label="Leads by stage">
          {STAGES.map((column) => {
            const cards = visible.filter((lead) => lead.stage === column.key)
            return (
              <section key={column.key}
                className={`board-col ${dropTarget === column.key ? 'is-target' : ''}`}
                onDragOver={(event) => { if (dragging) { event.preventDefault(); setDropTarget(column.key) } }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(event) => { event.preventDefault(); setDropTarget(null); if (dragging) moveTo(dragging, column.key); setDragging(null) }}>
                <header className="board-head">
                  <StagePill stage={column.key} />
                  <span className="board-count">{cards.length}</span>
                </header>
                <div className="board-cards">
                  {cards.map((lead, index) => (
                    <article key={lead.id} className={`card ${dragging === lead.id ? 'is-dragging' : ''}`} style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
                      draggable onDragStart={() => setDragging(lead.id)} onDragEnd={() => { setDragging(null); setDropTarget(null) }}>
                      <button className="card-main" onClick={() => setOpen(lead.id)}>
                        <b>{lead.full_name}</b>
                        <span className="muted small">{lead.courses?.name || 'Course not chosen'}</span>
                      </button>
                      <footer className="card-foot">
                        <FollowUpChip date={lead.next_follow_up_on} />
                        {isAdmin && <span className="card-owner">{lead.members?.full_name}</span>}
                        {lead.whatsapp && (
                          <a className="icon-btn icon-btn-sm whatsapp" href={whatsappLink(lead.whatsapp)} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${lead.full_name}`}>
                            <Icon name="whatsapp" size={16} />
                          </a>
                        )}
                      </footer>
                    </article>
                  ))}
                  {cards.length === 0 && <p className="board-empty">{dragging ? 'Drop here' : 'None'}</p>}
                </div>
              </section>
            )
          })}
        </div>
      ) : visible.length === 0 ? (
        <Empty icon="search" title="No leads match">Try another search or filter.</Empty>
      ) : (
        <div className="table-card">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Course</th><th>Stage</th><th>Follow-up</th>{isAdmin && <th>Marketer</th>}<th>Added</th><th><span className="sr-only">Contact</span></th></tr>
            </thead>
            <tbody>
              {visible.map((lead) => (
                <tr key={lead.id}>
                  <td data-label="Name"><button className="row-link" onClick={() => setOpen(lead.id)}>{lead.full_name}</button><small className="muted">{lead.whatsapp || lead.email}</small></td>
                  <td data-label="Course">{lead.courses?.name || '—'}</td>
                  <td data-label="Stage"><StagePill stage={lead.stage} /></td>
                  <td data-label="Follow-up">{lead.next_follow_up_on ? <FollowUpChip date={lead.next_follow_up_on} /> : '—'}</td>
                  {isAdmin && <td data-label="Marketer">{lead.members?.full_name || '—'}</td>}
                  <td data-label="Added" className="hide-mobile">{dayLabel(lead.created_at)}</td>
                  <td className="cell-actions">
                    {lead.whatsapp && (
                      <a className="icon-btn whatsapp" href={whatsappLink(lead.whatsapp)} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${lead.full_name}`}><Icon name="whatsapp" /></a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open !== undefined && <LeadDrawer leadId={open} onClose={() => setOpen(undefined)} onChanged={reload} />}
    </>
  )
}
