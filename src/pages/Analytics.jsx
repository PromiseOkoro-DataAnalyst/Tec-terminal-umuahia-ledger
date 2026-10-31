import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { useAuth } from '../context/auth'
import { useToast } from '../components/toast'
import { STAGES, addDaysISO, initials, monthLabel, naira, nairaShort, timeAgo, todayISO } from '../lib/format'
import { exportToExcel } from '../lib/exportExcel'
import { Columns3D, Donut, Gauge, LineChart, SplitBar, foldOther } from '../components/Charts'
import { AttentionList, Feed, KpiCard, ProgressList, RingDonut, StackedBars } from '../components/Dash'
import Icon from '../components/Icon'
import { ErrorNote, Loading, Segmented } from '../components/ui'

const PERIODS = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: '3 months' },
  { value: 'year', label: '12 months' },
  { value: 'all', label: 'All time' },
]
const METHOD_LABELS = { transfer: 'Transfer', cash: 'Cash', pos: 'POS', other: 'Other' }
const TONES = ['teal', 'violet', 'yellow', 'orange', 'blue', 'green', 'red']

const iso = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const dayDiff = (from, to) => Math.round((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 86400000)
const shortDate = (value) => new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

function periodRange(period, earliest) {
  const today = todayISO()
  const now = new Date()
  if (period === 'month') return { start: `${today.slice(0, 7)}-01`, end: today }
  if (period === 'quarter') return { start: addDaysISO(-89), end: today }
  if (period === 'year') return { start: iso(new Date(now.getFullYear() - 1, now.getMonth() + 1, 1)), end: today }
  return { start: earliest || addDaysISO(-365), end: today }
}

// Equal slices between two dates, for the dot grids
function slices(start, end, count) {
  const span = Math.max(1, dayDiff(start, end) + 1)
  const n = Math.min(count, span)
  return Array.from({ length: n }, (_, index) => {
    const from = addDaysISO(Math.floor((span * index) / n), start)
    const to = addDaysISO(Math.floor((span * (index + 1)) / n) - 1, start)
    return { start: from, end: to }
  })
}

// Calendar buckets for the stacked bars: weeks for short periods, months otherwise
function barBuckets(period, start, end) {
  if (period === 'month' || period === 'quarter') {
    const weeks = []
    for (let from = start; from <= end; from = addDaysISO(7, from)) {
      const to = addDaysISO(6, from) > end ? end : addDaysISO(6, from)
      weeks.push({ key: from, start: from, end: to, label: `${shortDate(from)} – ${shortDate(to)}`, short: shortDate(from) })
    }
    return weeks
  }
  const months = []
  const first = new Date(`${start}T12:00:00`)
  const cursor = new Date(first.getFullYear(), first.getMonth(), 1, 12)
  const last = period === 'all' ? new Date(`${end}T12:00:00`) : null
  while (iso(cursor) <= end && (period !== 'all' || months.length < 60)) {
    const from = iso(cursor)
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12)
    months.push({ key: from, start: from, end: addDaysISO(-1, iso(next)), label: monthLabel(from), short: cursor.toLocaleDateString('en-GB', { month: 'short' }) })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return last && months.length > 12 ? months.slice(-12) : months
}

const inRange = (date, range) => {
  const day = String(date).slice(0, 10)
  return day >= range.start && day <= range.end
}
const change = (now, before) => (before ? ((now - before) / before) * 100 : now ? null : 0)

const greeting = () => {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

export default function Analytics() {
  const { isAdmin, member } = useAuth()
  const toast = useToast()
  const [period, setPeriod] = useState('month')

  const { data, error } = useLoad(async () => {
    const optional = async (request) => { const { data: rows } = await request; return rows || [] }
    const [leads, students, payments, accounts, courses, members, commission, messages, activity] = await Promise.all([
      must(supabase.from('leads').select('id, full_name, stage, source, course_id, owner_id, created_at, next_follow_up_on')),
      must(supabase.from('students').select('id, full_name, course_id, owner_id, enrolled_on, lead_id')),
      must(supabase.from('payments').select('amount, paid_on, method, student_id, created_at')),
      must(supabase.from('student_accounts').select('*')),
      must(supabase.from('courses').select('id, name')),
      isAdmin ? must(supabase.from('members').select('id, full_name, email, status')) : [],
      must(supabase.from('monthly_commission').select('*')),
      optional(supabase.from('message_log').select('status, channel, queued_at').gte('queued_at', new Date(Date.now() - 14 * 86400000).toISOString())),
      isAdmin ? optional(supabase.from('activity_log').select('id, actor_id, summary, subject_type, created_at').order('created_at', { ascending: false }).limit(7)) : [],
    ])
    return { leads, students, payments, accounts, courses, members, commission, messages, activity }
  }, [isAdmin])

  const stats = useMemo(() => {
    if (!data) return null
    const today = todayISO()
    const earliest = [...data.leads.map((lead) => lead.created_at.slice(0, 10)), ...data.payments.map((payment) => payment.paid_on)].sort()[0]
    const range = periodRange(period, earliest)
    const length = dayDiff(range.start, range.end) + 1
    const previous = { start: addDaysISO(-length, range.start), end: addDaysISO(-1, range.start) }
    const ownerOf = Object.fromEntries(data.students.map((student) => [student.id, student.owner_id]))
    const studentName = Object.fromEntries(data.students.map((student) => [student.id, student.full_name]))
    const courseName = Object.fromEntries(data.courses.map((course) => [course.id, course.name]))
    const memberName = Object.fromEntries(data.members.map((person) => [person.id, person.full_name || person.email]))

    const leadsIn = (window) => data.leads.filter((lead) => inRange(lead.created_at, window))
    const studentsIn = (window) => data.students.filter((student) => inRange(student.enrolled_on, window))
    const paymentsIn = (window) => data.payments.filter((payment) => inRange(payment.paid_on, window))
    const sum = (rows) => rows.reduce((total, payment) => total + Number(payment.amount), 0)

    const leads = leadsIn(range)
    const students = studentsIn(range)
    const payments = paymentsIn(range)
    const collected = sum(payments)

    const dots = slices(range.start, range.end, period === 'month' ? 31 : 24)
    const live = data.accounts.filter((row) => row.status === 'active')
    const owing = live.filter((row) => Number(row.balance) > 0)
    const outstanding = owing.reduce((total, row) => total + Number(row.balance), 0)

    // Stacked bars: leads added per bucket, coloured by where they are now
    const buckets = barBuckets(period, range.start, range.end).map((bucket) => {
      const added = data.leads.filter((lead) => inRange(lead.created_at, bucket))
      const count = (stages) => added.filter((lead) => stages.includes(lead.stage)).length
      return { ...bucket, values: { enrolled: count(['enrolled']), warm: count(['interested', 'visited']), contacted: count(['contacted']), new: count(['new']), lost: count(['lost']) } }
    })

    // Balances by age, using each student's next due date
    const ageBands = [
      { key: 'notdue', label: 'Not due yet', tone: 'teal', test: (late) => late !== null && late <= 0 },
      { key: 'd30', label: '1 to 30 days late', tone: 'blue', test: (late) => late > 0 && late <= 30 },
      { key: 'd60', label: '31 to 60 days', tone: 'yellow', test: (late) => late > 30 && late <= 60 },
      { key: 'd90', label: '61 to 90 days', tone: 'orange', test: (late) => late > 60 && late <= 90 },
      { key: 'over', label: 'Over 90 days', tone: 'red', test: (late) => late > 90 },
      { key: 'nodate', label: 'No due date set', tone: 'grey', test: (late) => late === null },
    ]
    const ages = ageBands.map((band) => ({
      ...band,
      value: owing.filter((row) => band.test(row.next_due_on ? dayDiff(row.next_due_on, today) : null)).reduce((total, row) => total + Number(row.balance), 0),
    })).filter((band) => band.value > 0)

    // Needs attention
    const open = data.leads.filter((lead) => !['enrolled', 'lost'].includes(lead.stage))
    const overdueLeads = open.filter((lead) => lead.next_follow_up_on && lead.next_follow_up_on < today)
    const dueToday = open.filter((lead) => lead.next_follow_up_on === today)
    const lateFees = owing.filter((row) => row.next_due_on && row.next_due_on < today)
    const soonFees = owing.filter((row) => row.next_due_on && row.next_due_on >= today && row.next_due_on <= addDaysISO(7))
    const failed = data.messages.filter((row) => row.status === 'failed')
    const waiting = data.messages.filter((row) => row.status === 'queued' && row.channel === 'whatsapp')
    const pending = data.members.filter((person) => person.status === 'pending')
    const oldest = (rows, key) => rows.map((row) => row[key]).sort()[0]
    const attention = [
      lateFees.length && { key: 'fees', icon: 'wallet', tone: 'red', status: 'Overdue', to: '/students',
        title: `${lateFees.length} student${lateFees.length === 1 ? '' : 's'} late with fees`, detail: `${naira(lateFees.reduce((total, row) => total + Number(row.balance), 0))} owed, oldest due ${shortDate(oldest(lateFees, 'next_due_on'))}` },
      overdueLeads.length && { key: 'follow', icon: 'calendar', tone: 'orange', status: 'Overdue', to: '/leads',
        title: `${overdueLeads.length} follow-up${overdueLeads.length === 1 ? '' : 's'} overdue`, detail: `Oldest from ${shortDate(oldest(overdueLeads, 'next_follow_up_on'))}` },
      failed.length && { key: 'failed', icon: 'alert', tone: 'red', status: 'Failed', to: '/outbox',
        title: `${failed.length} message${failed.length === 1 ? '' : 's'} didn’t send`, detail: 'Last 14 days · retry from the Outbox' },
      waiting.length && { key: 'waiting', icon: 'whatsapp', tone: 'violet', status: 'Waiting', to: '/outbox',
        title: `${waiting.length} WhatsApp message${waiting.length === 1 ? '' : 's'} to send`, detail: 'Tap Send on each in the Outbox' },
      pending.length && { key: 'team', icon: 'team', tone: 'violet', status: 'Pending', to: '/team',
        title: `${pending.length} sign-up${pending.length === 1 ? '' : 's'} waiting for access`, detail: pending.slice(0, 2).map((person) => person.full_name || person.email).join(', ') },
      dueToday.length && { key: 'today', icon: 'hourglass', tone: 'yellow', status: 'Today', to: '/leads',
        title: `${dueToday.length} follow-up${dueToday.length === 1 ? '' : 's'} due today`, detail: dueToday.slice(0, 2).map((lead) => lead.full_name).join(', ') },
      soonFees.length && { key: 'soon', icon: 'calendar', tone: 'teal', status: 'This week', to: '/students',
        title: `${soonFees.length} payment${soonFees.length === 1 ? '' : 's'} due this week`, detail: naira(soonFees.reduce((total, row) => total + Number(row.next_due_amount || row.balance), 0)) },
    ].filter(Boolean).slice(0, 5)

    // Marketer load (admin) or top courses (marketer)
    const load = isAdmin
      ? data.members.filter((person) => person.status === 'active').map((person) => {
        const theirs = leads.filter((lead) => lead.owner_id === person.id)
        const won = theirs.filter((lead) => lead.stage === 'enrolled').length
        return { key: person.id, label: person.full_name || person.email, initials: initials(person.full_name || person.email), meta: `${won} of ${theirs.length} enrolled`, percent: theirs.length ? (won / theirs.length) * 100 : 0, size: theirs.length }
      }).filter((row) => row.size).sort((a, b) => b.percent - a.percent || b.size - a.size).slice(0, 5)
        .map((row, index) => ({ ...row, tone: TONES[index % TONES.length] }))
      : (() => {
        const byCourse = new Map()
        students.forEach((student) => byCourse.set(student.course_id, (byCourse.get(student.course_id) || 0) + 1))
        const top = Math.max(1, ...byCourse.values())
        return [...byCourse].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, count], index) => ({
          key: id, label: courseName[id] || 'Unknown', initials: initials(courseName[id] || '?'), meta: `${count} enrolled`, percent: (count / top) * 100, tone: TONES[index % TONES.length],
        }))
      })()

    // Live activity
    const feed = isAdmin
      ? data.activity.map((row, index) => ({
        key: row.id, tone: TONES[index % TONES.length], initials: initials(memberName[row.actor_id] || 'System'),
        title: `${memberName[row.actor_id] || 'System'} ${row.summary}`, detail: timeAgo(row.created_at),
      }))
      : [
        ...data.payments.map((payment) => ({ at: payment.created_at, key: `p${payment.created_at}${payment.student_id}`, tone: 'green', initials: '₦', title: `${naira(payment.amount)} from ${studentName[payment.student_id] || 'a student'}`, detail: timeAgo(payment.created_at) })),
        ...data.leads.map((lead) => ({ at: lead.created_at, key: `l${lead.id}`, tone: 'teal', initials: initials(lead.full_name), title: `New lead: ${lead.full_name}`, detail: timeAgo(lead.created_at) })),
      ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 7)

    // Deeper charts (12-month view, unchanged by the period switch except where noted)
    const months = Array.from({ length: 12 }, (_, index) => {
      const date = new Date()
      date.setDate(1)
      date.setMonth(date.getMonth() - (11 - index))
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    })
    const byMonth = (rows, dateOf, valueOf = () => 1) => months.map((key) => rows.filter((row) => dateOf(row).slice(0, 7) === key).reduce((total, row) => total + valueOf(row), 0))
    const agreed = data.accounts.filter((row) => row.status !== 'withdrawn').reduce((total, row) => total + Number(row.agreed_fee), 0)
    const paidAll = data.accounts.filter((row) => row.status !== 'withdrawn').reduce((total, row) => total + Number(row.total_paid), 0)
    const group = (rows, keyOf, valueOf = () => 1) => [...rows.reduce((map, row) => map.set(keyOf(row), (map.get(keyOf(row)) || 0) + valueOf(row)), new Map())]

    const team = isAdmin ? data.members.filter((person) => person.status === 'active').map((person) => {
      const theirLeads = leads.filter((lead) => lead.owner_id === person.id)
      return {
        id: person.id,
        name: person.full_name || person.email,
        leads: theirLeads.length,
        enrolled: students.filter((student) => student.owner_id === person.id).length,
        conversion: theirLeads.length ? Math.round((theirLeads.filter((lead) => lead.stage === 'enrolled').length / theirLeads.length) * 100) : null,
        collected: payments.filter((payment) => ownerOf[payment.student_id] === person.id).reduce((total, payment) => total + Number(payment.amount), 0),
        commission: data.commission.filter((row) => row.owner_id === person.id && inRange(row.month_start, range)).reduce((total, row) => total + Number(row.commission), 0),
      }
    }).filter((row) => row.leads || row.enrolled || row.collected).sort((a, b) => b.collected - a.collected) : []

    return {
      range,
      hasPrevious: period !== 'all',
      leadsAdded: leads.length,
      leadsDelta: change(leads.length, leadsIn(previous).length),
      leadsDots: dots.map((slice) => leadsIn(slice).length),
      enrolments: students.length,
      enrolDelta: change(students.length, studentsIn(previous).length),
      enrolDots: dots.map((slice) => studentsIn(slice).length),
      collected,
      collectedDelta: change(collected, sum(paymentsIn(previous))),
      collectedDots: dots.map((slice) => sum(paymentsIn(slice))),
      outstanding,
      owingCount: owing.length,
      owedDots: slices(owing.map((row) => row.enrolled_on).sort()[0] || range.start, today, 24)
        .map((slice) => owing.filter((row) => inRange(row.enrolled_on, slice)).reduce((total, row) => total + Number(row.balance), 0)),
      conversion: leads.length ? (leads.filter((lead) => lead.stage === 'enrolled').length / leads.length) * 100 : null,
      collectionRate: agreed ? (paidAll / agreed) * 100 : null,
      buckets,
      nowIndex: buckets.findIndex((bucket) => today >= bucket.start && today <= bucket.end),
      ages,
      attention,
      load,
      feed,
      openLeads: open.length,
      courseCount: new Set(open.map((lead) => lead.course_id).filter(Boolean)).size,
      months: months.map((key) => monthLabel(`${key}-01`)),
      monthShort: months.map((key) => new Date(`${key}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'short' })),
      collected12: byMonth(data.payments, (payment) => payment.paid_on, (payment) => Number(payment.amount)),
      leads12: byMonth(data.leads, (lead) => lead.created_at),
      enrol12: byMonth(data.students, (student) => student.enrolled_on),
      pipeline: STAGES.map((stage) => ({ key: stage.key, label: stage.label, value: data.leads.filter((lead) => lead.stage === stage.key).length, color: `var(--stage-${stage.key})` })).filter((item) => item.value),
      sources: foldOther(group(leads, (lead) => lead.source || 'Not recorded').map(([key, value]) => ({ key, label: key, value }))),
      methods: foldOther(group(payments, (payment) => payment.method, (payment) => Number(payment.amount)).map(([key, value]) => ({ key, label: METHOD_LABELS[key] || key, value }))),
      courses: group(students, (student) => courseName[student.course_id] || 'Unknown').map(([key, value]) => ({ key, label: key, value })).sort((a, b) => b.value - a.value).slice(0, 8),
      followUps: [
        { key: 'overdue', label: 'Overdue', value: overdueLeads.length, color: 'var(--a-red)' },
        { key: 'today', label: 'Due today', value: dueToday.length, color: 'var(--a-yellow)' },
        { key: 'later', label: 'Scheduled', value: open.filter((lead) => lead.next_follow_up_on && lead.next_follow_up_on > today).length, color: 'var(--a-teal)' },
        { key: 'none', label: 'No date set', value: open.filter((lead) => !lead.next_follow_up_on).length, color: 'var(--a-grey)' },
      ],
      team,
      maxTeam: Math.max(1, ...team.map((row) => row.collected)),
    }
  }, [data, period, isAdmin])

  const periodWord = { month: 'this month', quarter: 'the last 3 months', year: 'the last 12 months', all: 'all time' }[period]
  const versus = { month: 'vs last month', quarter: 'vs the 3 months before', year: 'vs the year before', all: '' }[period]

  const exportReport = () => exportToExcel({
    fileName: `TecTerminal analytics ${todayISO()}`,
    sheet: 'Summary',
    subject: 'analytics report',
    rows: [
      ['Period', `${stats.range.start} to ${stats.range.end}`],
      ['Leads added', stats.leadsAdded],
      ['Enrolments', stats.enrolments],
      ['Lead conversion (%)', stats.conversion == null ? null : Math.round(stats.conversion)],
      ['Collected (₦)', stats.collected],
      ['Still owed by active students (₦)', stats.outstanding],
      ['Students owing', stats.owingCount],
      ['Fees collected of agreed (%)', stats.collectionRate == null ? null : Math.round(stats.collectionRate)],
      ['Open leads', stats.openLeads],
      ...stats.ages.map((band) => [`Owed: ${band.label} (₦)`, band.value]),
      ...stats.team.map((row) => [`${row.name}: collected (₦)`, row.collected]),
    ],
    columns: [
      { header: 'Measure', value: (row) => row[0], width: 38 },
      { header: 'Value', value: (row) => row[1], width: 24 },
    ],
  }).catch((exportError) => toast(exportError.message, 'error'))

  const firstName = (member?.full_name || '').split(' ')[0]

  return (
    <div className="analytics">
      <header className="a-head">
        <div>
          <h1>{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
          <p className="a-sub">
            {stats
              ? <>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}. {stats.openLeads} open lead{stats.openLeads === 1 ? '' : 's'} across {stats.courseCount} course{stats.courseCount === 1 ? '' : 's'}, {stats.enrolments} enrolled {periodWord}. {stats.attention.length ? `${stats.attention.length} item${stats.attention.length === 1 ? '' : 's'} need attention.` : 'Nothing needs attention.'}</>
              : 'Loading the numbers…'}
          </p>
        </div>
        <div className="a-actions">
          <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS} />
          <button className="btn a-btn" onClick={exportReport} disabled={!stats}><Icon name="download" size={17} /> Export report</button>
        </div>
      </header>
      <ErrorNote>{error}</ErrorNote>

      {!stats ? <Loading rows={6} /> : (
        <>
          <section className="kpis">
            <KpiCard icon="leads" tone="teal" label="Leads added" value={stats.leadsAdded} delta={stats.hasPrevious ? stats.leadsDelta : undefined} series={stats.leadsDots} foot={versus} />
            <KpiCard icon="students" tone="violet" label="Enrolments" value={stats.enrolments} delta={stats.hasPrevious ? stats.enrolDelta : undefined} series={stats.enrolDots} foot={versus} />
            <KpiCard icon="commission" tone="yellow" label="Collected" value={stats.collected} format={nairaShort} delta={stats.hasPrevious ? stats.collectedDelta : undefined} series={stats.collectedDots} foot={versus} />
            <KpiCard icon="hourglass" tone="orange" label="Still owed" value={stats.outstanding} format={nairaShort} series={stats.owedDots} foot={`${stats.owingCount} student${stats.owingCount === 1 ? '' : 's'} owing, by enrolment date`} />
          </section>

          <div className="a-row a-row-main">
            <section className="acard">
              <header className="acard-head">
                <div><h2>Leads by {period === 'month' || period === 'quarter' ? 'week' : 'month'}</h2><p>Bars show leads added, coloured by where they are now.</p></div>
              </header>
              <StackedBars buckets={stats.buckets} nowIndex={stats.nowIndex} unit={[' lead', ' leads']}
                segments={[
                  { key: 'enrolled', label: 'Enrolled', tone: 'green' },
                  { key: 'warm', label: 'Interested / visited', tone: 'blue' },
                  { key: 'contacted', label: 'Contacted', tone: 'yellow' },
                  { key: 'new', label: 'New', tone: 'grey' },
                  { key: 'lost', label: 'Lost', tone: 'red' },
                ]} />
            </section>
            <section className="acard">
              <header className="acard-head"><div><h2>Needs attention</h2><p>Most urgent first</p></div></header>
              <AttentionList items={stats.attention} />
            </section>
          </div>

          <div className="a-row a-row-three">
            <section className="acard">
              <header className="acard-head"><div><h2>{isAdmin ? 'Marketer load' : 'Top courses'}</h2><p>{isAdmin ? `Enrolled versus leads, ${periodWord}` : `Your enrolments, ${periodWord}`}</p></div></header>
              <ProgressList rows={stats.load} empty={isAdmin ? 'No marketer activity in this period.' : 'No enrolments in this period.'} />
            </section>
            <section className="acard">
              <header className="acard-head"><div><h2>Balances by age</h2><p>{stats.owingCount} student{stats.owingCount === 1 ? '' : 's'} owing, by next due date</p></div></header>
              <RingDonut data={stats.ages} format={nairaShort} centerLabel="outstanding" empty="Every active student is paid up." />
            </section>
            <section className="acard">
              <header className="acard-head"><div><h2>Live activity</h2><p>{isAdmin ? 'Across the centre' : 'Your latest leads and payments'}</p></div><span className="live-dot" aria-hidden="true" /></header>
              <Feed items={stats.feed} />
            </section>
          </div>

          <h2 className="a-section">Deeper look</h2>

          <div className="a-row a-row-main">
            <section className="acard">
              <header className="acard-head"><div><h2>Collections</h2><p>Last 12 months</p></div></header>
              <LineChart labels={stats.months} shortLabels={stats.monthShort} series={[{ key: 'collected', label: 'Collected', color: 'var(--a-teal)', values: stats.collected12 }]}
                format={nairaShort} label="Payments collected per month" />
            </section>
            <section className="acard gauges">
              <Gauge value={stats.conversion} label="Lead conversion" sub={`of leads added, ${periodWord}`} tone="var(--a-violet)" />
              <Gauge value={stats.collectionRate} label="Fees collected" sub="of agreed fees" tone="var(--a-green)" />
            </section>
          </div>

          <div className="a-row a-row-three">
            <section className="acard">
              <header className="acard-head"><div><h2>Leads and enrolments</h2><p>Last 12 months</p></div></header>
              <LineChart labels={stats.months} shortLabels={stats.monthShort} area={false} height={220} format={(value) => Math.round(value)}
                series={[
                  { key: 'leads', label: 'Leads added', color: 'var(--a-teal)', values: stats.leads12 },
                  { key: 'enrolled', label: 'Enrolments', color: 'var(--a-orange)', values: stats.enrol12 },
                ]} label="Leads and enrolments per month" />
            </section>
            <section className="acard">
              <header className="acard-head"><div><h2>Pipeline right now</h2><p>Every lead by stage</p></div></header>
              <Donut data={stats.pipeline} centerLabel="All leads" empty="No leads yet." />
            </section>
            <section className="acard">
              <header className="acard-head"><div><h2>Where leads come from</h2><p>{periodWord}</p></div></header>
              <Donut data={stats.sources} centerLabel="Leads" empty="No leads in this period." />
            </section>
            <section className="acard">
              <header className="acard-head"><div><h2>How students pay</h2><p>{periodWord}</p></div></header>
              <Donut data={stats.methods} pie format={nairaShort} empty="No payments in this period." />
            </section>
            <section className="acard">
              <header className="acard-head"><div><h2>Follow-up health</h2><p>Open leads</p></div></header>
              <SplitBar data={stats.followUps} />
            </section>
            <section className="acard">
              <header className="acard-head"><div><h2>Popular courses</h2><p>{periodWord}</p></div></header>
              <Columns3D data={stats.courses} empty="No enrolments in this period." tone="var(--a-violet)" />
            </section>
          </div>

          {isAdmin && (
            <section className="acard">
              <header className="acard-head"><div><h2>Marketers</h2><p>{periodWord}</p></div></header>
              {stats.team.length === 0 ? <p className="muted">No marketer activity in this period.</p> : (
                <div className="table-card table-flat">
                  <table className="table">
                    <thead><tr><th>Marketer</th><th className="num">Leads</th><th className="num">Enrolled</th><th className="num">Conversion</th><th>Collected</th><th className="num">Commission</th></tr></thead>
                    <tbody>
                      {stats.team.map((row) => (
                        <tr key={row.id}>
                          <td data-label="Marketer"><b>{row.name}</b></td>
                          <td data-label="Leads" className="num">{row.leads}</td>
                          <td data-label="Enrolled" className="num">{row.enrolled}</td>
                          <td data-label="Conversion" className="num">{row.conversion == null ? '—' : `${row.conversion}%`}</td>
                          <td data-label="Collected">
                            <span className="inline-bar"><span style={{ width: `${(row.collected / stats.maxTeam) * 100}%` }} /></span>
                            <span className="inline-bar-value">{naira(row.collected)}</span>
                          </td>
                          <td data-label="Commission" className="num money-in">{naira(row.commission)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
