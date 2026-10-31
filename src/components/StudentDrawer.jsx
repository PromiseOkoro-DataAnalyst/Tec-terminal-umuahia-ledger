import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { useAuth } from '../context/auth'
import { useToast } from './toast'
import { dayLabel, followUpLabel, naira, todayISO, whatsappLink } from '../lib/format'
import Icon from './Icon'
import MessageComposer from './MessageComposer'
import { Drawer, ErrorNote, Field, Loading, Segmented } from './ui'

const METHODS = { transfer: 'Transfer', cash: 'Cash', pos: 'POS', other: 'Other' }

export default function StudentDrawer({ account, onClose, onChanged }) {
  const { isAdmin, user } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({ amount: '', paid_on: todayISO(), method: 'transfer', reference: '' })
  const [busy, setBusy] = useState(false)
  const [messaging, setMessaging] = useState(false)
  const [due, setDue] = useState({ on: account.next_due_on || '', amount: account.next_due_amount ?? '' })
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value })

  const { data, error, reload } = useLoad(async () => ({
    payments: await must(supabase.from('payments').select('*, members(full_name)')
      .eq('student_id', account.student_id).order('paid_on', { ascending: false }).order('created_at', { ascending: false })),
  }), [account.student_id, account.total_paid])

  const changed = () => { reload(); onChanged() }

  const record = async (event) => {
    event.preventDefault()
    setBusy(true)
    const { error: saveError } = await supabase.from('payments').insert({
      student_id: account.student_id, amount: Number(form.amount), paid_on: form.paid_on,
      method: form.method, reference: form.reference.trim() || null, recorded_by: user.id,
    })
    setBusy(false)
    if (saveError) return toast(saveError.message, 'error')
    toast(`${naira(form.amount)} recorded`)
    setForm({ ...form, amount: '', reference: '' })
    changed()
  }

  const removePayment = async (payment) => {
    if (!window.confirm(`Delete the ${naira(payment.amount)} payment from ${dayLabel(payment.paid_on)}?`)) return
    const { error: deleteError } = await supabase.from('payments').delete().eq('id', payment.id)
    if (deleteError) return toast(deleteError.message, 'error')
    toast('Payment deleted')
    changed()
  }

  const setStatus = async (status) => {
    const { error: saveError } = await supabase.from('students').update({ status }).eq('id', account.student_id)
    if (saveError) return toast(saveError.message, 'error')
    toast(`Marked as ${status}`)
    onChanged()
  }

  const dueChanged = (due.on || '') !== (account.next_due_on || '') || String(due.amount ?? '') !== String(account.next_due_amount ?? '')

  const saveDue = async (event) => {
    event.preventDefault()
    setBusy(true)
    const { error: saveError } = await supabase.from('students')
      .update({ next_due_on: due.on || null, next_due_amount: due.amount === '' ? null : Number(due.amount) })
      .eq('id', account.student_id)
    setBusy(false)
    if (saveError) return toast(saveError.message, 'error')
    toast(due.on ? `Next payment due ${dayLabel(due.on)}` : 'Due date cleared')
    onChanged()
  }

  const setOptOut = async (optedOut) => {
    const { error: saveError } = await supabase.from('students').update({ opted_out: optedOut }).eq('id', account.student_id)
    if (saveError) return toast(saveError.message, 'error')
    toast(optedOut ? 'Automatic messages stopped for this student' : 'Automatic reminders back on')
    onChanged()
  }

  const progress = account.agreed_fee > 0 ? Math.min(100, (account.total_paid / account.agreed_fee) * 100) : 100
  const balance = Math.max(0, Number(account.balance))

  return (
    <Drawer title={account.full_name} sub={`${account.course_name} · enrolled ${dayLabel(account.enrolled_on)}`} onClose={onClose}>
      <div className="contact-row">
        {account.whatsapp && (
          <a className="btn btn-whatsapp" target="_blank" rel="noreferrer"
            href={whatsappLink(account.whatsapp, balance > 0 ? `Hello ${account.full_name.split(' ')[0]}, a quick reminder from TecTerminal Umuahia: your balance for ${account.course_name} is ${naira(balance)}.` : undefined)}>
            <Icon name="whatsapp" size={18} /> {balance > 0 ? 'Send balance reminder' : 'WhatsApp'}
          </a>
        )}
        {account.whatsapp && <a className="btn" href={`tel:${account.whatsapp.replace(/\s/g, '')}`}><Icon name="phone" size={18} /> Call</a>}
        {(account.whatsapp || account.email) && !account.opted_out && (
          <button className="btn btn-primary" onClick={() => setMessaging(true)}><Icon name="template" size={18} /> Use a template</button>
        )}
      </div>
      {messaging && (
        <MessageComposer person={{ kind: 'student', id: account.student_id, name: account.full_name, whatsapp: account.whatsapp, email: account.email }}
          onClose={() => setMessaging(false)} />
      )}

      <section className="money-card">
        <div className="money-figures">
          <div><span>Agreed fee</span><b>{naira(account.agreed_fee)}</b></div>
          <div><span>Paid</span><b className="money-in">{naira(account.total_paid)}</b></div>
          <div><span>Balance</span><b className={balance > 0 ? 'money-owed' : 'money-in'}>{balance > 0 ? naira(balance) : 'Paid up'}</b></div>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress}%` }} />
        </div>
      </section>

      <section className="drawer-section">
        <h3>Next payment due {balance > 0 && account.next_due_on && <DueChip date={account.next_due_on} />}</h3>
        <form className="form" onSubmit={saveDue}>
          <div className="form-row">
            <Field label="Due date"><input type="date" value={due.on} onChange={(event) => setDue({ ...due, on: event.target.value })} /></Field>
            <Field label="Amount (₦)" hint="Blank = whole balance">
              <input type="number" min="1" step="any" value={due.amount} onChange={(event) => setDue({ ...due, amount: event.target.value })} placeholder={balance > 0 ? String(balance) : ''} />
            </Field>
          </div>
          <div className="row spread">
            <label className="check">
              <input type="checkbox" checked={!account.opted_out} onChange={() => setOptOut(!account.opted_out)} /> Automatic reminders and broadcasts
            </label>
            {dueChanged && <button className="btn btn-small btn-primary" disabled={busy}>Save due date</button>}
          </div>
        </form>
      </section>

      <section className="drawer-section">
        <h3>Record a payment</h3>
        <form className="form" onSubmit={record}>
          <div className="form-row">
            <Field label="Amount (₦)">
              <input type="number" min="1" step="any" required value={form.amount} onChange={update('amount')} placeholder={balance > 0 ? String(balance) : ''} />
            </Field>
            <Field label="Date paid"><input type="date" required value={form.paid_on} onChange={update('paid_on')} max={todayISO()} /></Field>
          </div>
          <div className="form-row">
            <Field label="Paid by">
              <select value={form.method} onChange={update('method')}>
                {Object.entries(METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Reference" hint="Teller or transfer ref"><input value={form.reference} onChange={update('reference')} /></Field>
          </div>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Recording…' : 'Record payment'}</button>
        </form>
      </section>

      <section className="drawer-section">
        <h3>Payment history</h3>
        <ErrorNote>{error}</ErrorNote>
        {!data ? <Loading rows={3} /> : data.payments.length === 0 ? <p className="muted small">No payments recorded yet.</p> : (
          <ul className="ledger">
            {data.payments.map((payment) => (
              <li key={payment.id}>
                <span className="ledger-main">
                  <b>{dayLabel(payment.paid_on)}</b>
                  <small>{[METHODS[payment.method], payment.reference, payment.members?.full_name && `by ${payment.members.full_name}`].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="row">
                  <b className="money-in">{naira(payment.amount)}</b>
                  {isAdmin && <button className="icon-btn icon-btn-sm" onClick={() => removePayment(payment)} aria-label="Delete payment"><Icon name="trash" size={15} /></button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="drawer-section">
        <h3>Status</h3>
        <Segmented label="Student status" value={account.status} onChange={setStatus}
          options={[{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'withdrawn', label: 'Withdrawn' }]} />
      </section>
    </Drawer>
  )
}

function DueChip({ date }) {
  const label = followUpLabel(date)
  if (!label) return null
  return <span className={`due due-${label.tone}`}><Icon name="calendar" size={13} />{label.text.replace('Overdue', 'Overdue by')}</span>
}
