import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { useAuth } from '../context/auth'
import { useToast } from '../components/toast'
import { addDaysISO, dayLabel, naira, todayISO } from '../lib/format'
import { exportToExcel } from '../lib/exportExcel'
import StudentDrawer from '../components/StudentDrawer'
import Icon from '../components/Icon'
import { Empty, ErrorNote, Field, FollowUpChip, Loading, Modal, PageHead, Search, Segmented } from '../components/ui'

export default function Students() {
  const { isAdmin, user } = useAuth()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [money, setMoney] = useState('all')
  const [status, setStatus] = useState('active')
  const [openId, setOpenId] = useState(null)
  const [adding, setAdding] = useState(false)

  const { data, error, reload } = useLoad(async () => {
    const [accounts, members, courses] = await Promise.all([
      must(supabase.from('student_accounts').select('*').order('enrolled_on', { ascending: false })),
      isAdmin ? must(supabase.from('members').select('id, full_name, email')) : [],
      must(supabase.from('courses').select('id, name, standard_fee').eq('is_active', true).order('name')),
    ])
    const names = Object.fromEntries(members.map((person) => [person.id, person.full_name || person.email]))
    return { accounts: accounts.map((row) => ({ ...row, owner_name: names[row.owner_id] })), courses }
  }, [isAdmin])

  const accounts = useMemo(() => data?.accounts || [], [data])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return accounts.filter((row) =>
      (status === 'all' || row.status === status) &&
      (money === 'all' || (money === 'owing' ? row.balance > 0
        : money === 'due' ? row.balance > 0 && row.next_due_on && row.next_due_on <= addDaysISO(7)
          : row.balance <= 0)) &&
      (!needle || [row.full_name, row.course_name, row.whatsapp, row.email].join(' ').toLowerCase().includes(needle)))
  }, [accounts, query, money, status])

  const totals = visible.reduce((sum, row) => ({
    paid: sum.paid + Number(row.total_paid),
    owed: sum.owed + Math.max(0, Number(row.balance)),
  }), { paid: 0, owed: 0 })

  const exportStudents = () => exportToExcel({
    fileName: `TecTerminal students ${todayISO()}`,
    sheet: 'Students',
    subject: 'student',
    rows: visible,
    columns: [
      { header: 'Name', value: (row) => row.full_name, width: 26 },
      { header: 'WhatsApp', value: (row) => row.whatsapp, width: 16 },
      { header: 'Email', value: (row) => row.email, width: 26 },
      { header: 'Course', value: (row) => row.course_name, width: 22 },
      { header: 'Enrolled', value: (row) => new Date(`${row.enrolled_on}T12:00:00`), width: 14 },
      { header: 'Status', value: (row) => row.status, width: 12 },
      { header: 'Agreed fee (₦)', value: (row) => Number(row.agreed_fee), width: 16 },
      { header: 'Paid (₦)', value: (row) => Number(row.total_paid), width: 14 },
      { header: 'Balance (₦)', value: (row) => Number(row.balance), width: 14 },
      { header: 'Last payment', value: (row) => (row.last_paid_on ? new Date(`${row.last_paid_on}T12:00:00`) : null), width: 14 },
      { header: 'Next due', value: (row) => (row.next_due_on ? new Date(`${row.next_due_on}T12:00:00`) : null), width: 14 },
      { header: 'Next due amount (₦)', value: (row) => (row.next_due_amount == null ? null : Number(row.next_due_amount)), width: 18 },
      { header: 'Payments', value: (row) => Number(row.payment_count), width: 10 },
      ...(isAdmin ? [{ header: 'Marketer', value: (row) => row.owner_name, width: 20 }] : []),
    ],
  }).catch((exportError) => toast(exportError.message, 'error'))

  const open = accounts.find((row) => row.student_id === openId)

  return (
    <>
      <PageHead title="Students" sub={data ? `${naira(totals.paid)} paid · ${naira(totals.owed)} still owed` : ' '}>
        <button className="btn" onClick={exportStudents} disabled={!visible.length}><Icon name="download" size={18} /> Excel</button>
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} /> Add student</button>
      </PageHead>

      <div className="toolbar">
        <Search value={query} onChange={setQuery} placeholder="Search name, course or phone" />
        <Segmented label="Payment" value={money} onChange={setMoney}
          options={[{ value: 'all', label: 'All' }, { value: 'owing', label: 'Owing' }, { value: 'due', label: 'Due / overdue' }, { value: 'paid', label: 'Paid up' }]} />
      </div>
      <div className="filters">
        <select className="chip-select" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
          <option value="active">Active students</option>
          <option value="completed">Completed</option>
          <option value="withdrawn">Withdrawn</option>
          <option value="all">Everyone</option>
        </select>
      </div>

      <ErrorNote>{error}</ErrorNote>
      {!data ? <Loading rows={6} /> : visible.length === 0 ? (
        <Empty icon="students" title={accounts.length ? 'No students match' : 'No students yet'}>
          {accounts.length ? 'Try another search or filter.' : 'Enrol a lead from the Leads page, or add a walk-in student here.'}
        </Empty>
      ) : (
        <div className="table-card">
          <table className="table">
            <thead>
              <tr><th>Student</th><th>Course</th><th>Enrolled</th><th>Last payment</th><th>Next due</th><th className="num">Paid</th><th className="num">Balance</th>{isAdmin && <th>Marketer</th>}</tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const progress = row.agreed_fee > 0 ? Math.min(100, (row.total_paid / row.agreed_fee) * 100) : 100
                return (
                  <tr key={row.student_id}>
                    <td data-label="Student">
                      <button className="row-link" onClick={() => setOpenId(row.student_id)}>{row.full_name}</button>
                      <span className="mini-progress" aria-label={`${Math.round(progress)}% paid`}><span style={{ width: `${progress}%` }} /></span>
                    </td>
                    <td data-label="Course">{row.course_name}</td>
                    <td data-label="Enrolled" className="hide-mobile">{dayLabel(row.enrolled_on)}</td>
                    <td data-label="Last payment" className="hide-mobile">{dayLabel(row.last_paid_on)}</td>
                    <td data-label="Next due">{row.balance > 0 && row.next_due_on ? <FollowUpChip date={row.next_due_on} /> : <span className="muted">—</span>}</td>
                    <td data-label="Paid" className="num">{naira(row.total_paid)}</td>
                    <td data-label="Balance" className={`num ${row.balance > 0 ? 'money-owed' : 'money-in'}`}>{row.balance > 0 ? naira(row.balance) : 'Paid up'}</td>
                    {isAdmin && <td data-label="Marketer">{row.owner_name || '—'}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && <StudentDrawer account={open} onClose={() => setOpenId(null)} onChanged={reload} />}
      {adding && <AddStudent courses={data?.courses || []} userId={user.id} onClose={() => setAdding(false)}
        onSaved={(id) => { setAdding(false); toast('Student added'); reload().then(() => setOpenId(id)) }} />}
    </>
  )
}

function AddStudent({ courses, userId, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState({
    full_name: '', whatsapp: '', email: '', course_id: courses[0]?.id || '',
    agreed_fee: courses[0] ? String(Number(courses[0].standard_fee)) : '', enrolled_on: todayISO(), first_payment: '', method: 'transfer',
  })
  const [busy, setBusy] = useState(false)
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value })
  const pickCourse = (event) => {
    const course = courses.find((item) => item.id === event.target.value)
    setForm({ ...form, course_id: event.target.value, agreed_fee: course ? String(Number(course.standard_fee)) : form.agreed_fee })
  }

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    const { data, error } = await supabase.from('students').insert({
      full_name: form.full_name.trim(), whatsapp: form.whatsapp.trim() || null, email: form.email.trim() || null,
      course_id: form.course_id, agreed_fee: Number(form.agreed_fee), enrolled_on: form.enrolled_on,
    }).select('id').single()
    if (error) { setBusy(false); return toast(error.message, 'error') }
    if (Number(form.first_payment) > 0) {
      const { error: paymentError } = await supabase.from('payments').insert({
        student_id: data.id, amount: Number(form.first_payment), paid_on: form.enrolled_on, method: form.method, recorded_by: userId,
      })
      if (paymentError) toast(`Student saved, but the payment wasn’t: ${paymentError.message}`, 'error')
    }
    onSaved(data.id)
  }

  return (
    <Modal title="Add a walk-in student" onClose={onClose}>
      {!courses.length ? <p className="note">Add a course on the Courses page first.</p> : (
        <form className="form" onSubmit={save}>
          <Field label="Full name"><input required autoFocus value={form.full_name} onChange={update('full_name')} /></Field>
          <div className="form-row">
            <Field label="WhatsApp"><input value={form.whatsapp} onChange={update('whatsapp')} inputMode="tel" /></Field>
            <Field label="Email"><input type="email" value={form.email} onChange={update('email')} /></Field>
          </div>
          <Field label="Course">
            <select required value={form.course_id} onChange={pickCourse}>
              {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
          </Field>
          <div className="form-row">
            <Field label="Agreed fee (₦)"><input type="number" min="0" step="any" required value={form.agreed_fee} onChange={update('agreed_fee')} /></Field>
            <Field label="Enrolment date"><input type="date" required value={form.enrolled_on} onChange={update('enrolled_on')} /></Field>
          </div>
          <div className="form-row">
            <Field label="First payment (₦)" hint="Optional"><input type="number" min="0" step="any" value={form.first_payment} onChange={update('first_payment')} /></Field>
            <Field label="Paid by">
              <select value={form.method} onChange={update('method')}>
                <option value="transfer">Transfer</option><option value="cash">Cash</option><option value="pos">POS</option><option value="other">Other</option>
              </select>
            </Field>
          </div>
          <div className="row end">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Add student'}</button>
          </div>
        </form>
      )}
    </Modal>
  )
}
