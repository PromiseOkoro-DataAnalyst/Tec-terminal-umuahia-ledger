import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { useAuth } from '../context/auth'
import { addDaysISO, monthName, monthStartISO, naira, nairaShort, shortDay, tierFor, todayISO, whatsappLink } from '../lib/format'
import TierRail from '../components/TierRail'
import LeadDrawer from '../components/LeadDrawer'
import Icon from '../components/Icon'
import { CountUp, Empty, ErrorNote, FollowUpChip, Loading, StagePill } from '../components/ui'

const greeting = () => {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

export default function Today() {
  const { member, isAdmin } = useAuth()
  const [openLead, setOpenLead] = useState(null)

  const { data, error, reload } = useLoad(async () => {
    const [tiers, month, due, newLeads, owing, payments] = await Promise.all([
      must(supabase.from('commission_tiers').select('*')),
      must(supabase.from('monthly_commission').select('*').eq('month_start', monthStartISO())),
      must(supabase.from('leads').select('id, full_name, whatsapp, stage, next_follow_up_on, courses(name)')
        .lte('next_follow_up_on', todayISO()).not('stage', 'in', '(enrolled,lost)')
        .order('next_follow_up_on').limit(8)),
      supabase.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', addDaysISO(-6)),
      must(supabase.from('student_accounts').select('balance').gt('balance', 0)),
      must(supabase.from('payments').select('id, amount, paid_on, method, students(full_name, courses(name))')
        .order('paid_on', { ascending: false }).order('created_at', { ascending: false }).limit(5)),
    ])
    return { tiers, month, due, newLeadCount: newLeads.count || 0, owing, payments }
  }, [])

  const firstName = (member?.full_name || '').split(' ')[0]

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow-date">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
        </div>
      </header>

      <ErrorNote>{error && `Couldn’t load today’s figures: ${error}`}</ErrorNote>
      {!data ? <Loading rows={5} /> : (
        <>
          <Hero data={data} isAdmin={isAdmin} />

          <section className="tiles">
            <div className="tile tilt">
              <span className="tile-label">Follow-ups due</span>
              <strong className="tile-figure"><CountUp value={data.due.length} />{data.due.length === 8 ? '+' : ''}</strong>
            </div>
            <div className="tile tilt">
              <span className="tile-label">New leads this week</span>
              <strong className="tile-figure"><CountUp value={data.newLeadCount} /></strong>
            </div>
            <div className="tile tilt">
              <span className="tile-label">Students still owing</span>
              <strong className="tile-figure"><CountUp value={data.owing.length} /></strong>
              <span className="tile-foot">{naira(data.owing.reduce((sum, row) => sum + Number(row.balance), 0))} outstanding</span>
            </div>
          </section>

          <div className="split">
            <section className="panel tilt">
              <header className="panel-head">
                <h2>Follow up today</h2>
                <Link to="/leads" className="link">All leads</Link>
              </header>
              {data.due.length === 0 ? (
                <Empty icon="check" title="You’re all caught up">No follow-ups due. Set a follow-up date on a lead and it will show here.</Empty>
              ) : (
                <ul className="queue">
                  {data.due.map((lead) => (
                    <li key={lead.id}>
                      <button className="queue-main" onClick={() => setOpenLead(lead.id)}>
                        <b>{lead.full_name}</b>
                        <span className="queue-meta">
                          <StagePill stage={lead.stage} />
                          {lead.courses?.name && <span className="muted">{lead.courses.name}</span>}
                        </span>
                      </button>
                      <FollowUpChip date={lead.next_follow_up_on} />
                      {lead.whatsapp && (
                        <a className="icon-btn whatsapp" href={whatsappLink(lead.whatsapp, `Hello ${lead.full_name.split(' ')[0]}, this is ${firstName || 'your contact'} from TecTerminal Umuahia.`)}
                          target="_blank" rel="noreferrer" aria-label={`WhatsApp ${lead.full_name}`}>
                          <Icon name="whatsapp" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel tilt">
              <header className="panel-head">
                <h2>Latest payments</h2>
                <Link to="/students" className="link">All students</Link>
              </header>
              {data.payments.length === 0 ? (
                <Empty icon="students" title="No payments yet">Payments you record on a student appear here.</Empty>
              ) : (
                <ul className="ledger">
                  {data.payments.map((payment) => (
                    <li key={payment.id}>
                      <span className="ledger-main">
                        <b>{payment.students?.full_name}</b>
                        <small>{payment.students?.courses?.name} · {shortDay(payment.paid_on)} · {payment.method}</small>
                      </span>
                      <b className="money-in">{naira(payment.amount)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      {openLead && <LeadDrawer leadId={openLead} onClose={() => setOpenLead(null)} onChanged={reload} />}
    </>
  )
}

function Hero({ data, isAdmin }) {
  const month = monthName(new Date())
  const total = data.month.reduce((sum, row) => sum + Number(row.total_collected), 0)
  const commission = data.month.reduce((sum, row) => sum + Number(row.commission), 0)
  const { current, next } = tierFor(data.tiers, total)

  if (isAdmin) {
    const ranked = [...data.month].sort((a, b) => b.total_collected - a.total_collected)
    return (
      <section className="hero glass">
        <p className="hero-line">
          <span className="hero-figure"><CountUp value={total} format={naira} /></span> collected across the centre in {month}.
        </p>
        <p className="hero-sub">
          {ranked.length
            ? `${naira(commission)} commission owed to ${ranked.length} marketer${ranked.length === 1 ? '' : 's'} so far.`
            : 'No payments recorded this month yet.'}
        </p>
        {ranked.length > 0 && (
          <ol className="podium">
            {ranked.map((row) => (
              <li key={row.owner_id}>
                <span className="podium-name">{row.marketer_name || 'Unnamed'}</span>
                <TierRail tiers={data.tiers} total={Number(row.total_collected)} compact />
                <span className="podium-figure">{nairaShort(row.total_collected)} <small>at {Number(row.rate_percent)}%</small></span>
              </li>
            ))}
          </ol>
        )}
      </section>
    )
  }

  const toNext = next ? Math.max(0, Number(next.lower_bound) - total) : 0
  return (
    <section className="hero glass">
      <p className="hero-line">
        <span className="hero-figure"><CountUp value={total} format={naira} /></span> collected in {month}.
      </p>
      <p className="hero-sub">
        {!data.tiers.length ? 'Commission tiers haven’t been set yet.'
          : total === 0 ? `Your first payment this month starts you at ${Number(tierFor(data.tiers, 0).sorted[0].rate_percent)}%.`
          : next ? <>That earns <b>{naira(commission)}</b> at {Number(current?.rate_percent || 0)}%. {naira(toNext)} more and the whole month earns {Number(next.rate_percent)}%.</>
          : <>You’re on the top rate: <b>{Number(current.rate_percent)}%</b> on everything, worth {naira(commission)} so far.</>}
      </p>
      <TierRail tiers={data.tiers} total={total} />
    </section>
  )
}
