import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { must, useLoad } from '../lib/useLoad'
import { useAuth } from '../context/auth'
import { useToast } from '../components/toast'
import { monthLabel, naira, todayISO } from '../lib/format'
import { exportToExcel } from '../lib/exportExcel'
import Icon from '../components/Icon'
import { Empty, ErrorNote, Loading, PageHead } from '../components/ui'

export default function Commission() {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const [month, setMonth] = useState('all')

  const { data, error, reload } = useLoad(async () => ({
    tiers: await must(supabase.from('commission_tiers').select('*').order('lower_bound')),
    history: await must(supabase.from('monthly_commission').select('*').order('month_start', { ascending: false })),
  }), [])

  const months = useMemo(() => [...new Set((data?.history || []).map((row) => row.month_start))], [data])
  const rows = (data?.history || []).filter((row) => month === 'all' || row.month_start === month)

  const exportHistory = () => exportToExcel({
    fileName: `TecTerminal commission ${todayISO()}`,
    sheet: 'Commission',
    subject: 'commission row',
    rows,
    columns: [
      { header: 'Month', value: (row) => monthLabel(row.month_start), width: 18 },
      ...(isAdmin ? [{ header: 'Marketer', value: (row) => row.marketer_name, width: 22 }] : []),
      { header: 'Payments', value: (row) => Number(row.payment_count), width: 10 },
      { header: 'Collected (₦)', value: (row) => Number(row.total_collected), width: 16 },
      { header: 'Rate (%)', value: (row) => Number(row.rate_percent), width: 10 },
      { header: 'Commission (₦)', value: (row) => Number(row.commission), width: 16 },
    ],
  }).catch((exportError) => toast(exportError.message, 'error'))

  return (
    <>
      <PageHead title="Commission" sub="Each marketer’s payments are added up per calendar month. The whole month earns the rate of the tier that total lands in." />
      <ErrorNote>{error}</ErrorNote>
      {!data ? <Loading /> : (
        <>
          {isAdmin ? <TierEditor key={data.tiers.map((tier) => tier.id).join()} tiers={data.tiers} onSaved={reload} /> : <TierTable tiers={data.tiers} />}

          <section className="panel">
            <header className="panel-head">
              <h2>Month by month</h2>
              <div className="row">
                {months.length > 1 && (
                  <select className="chip-select" value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Month">
                    <option value="all">All months</option>
                    {months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
                  </select>
                )}
                <button className="btn btn-small" onClick={exportHistory} disabled={!rows.length}><Icon name="download" size={16} /> Excel</button>
              </div>
            </header>
            {rows.length === 0 ? <Empty icon="commission" title="Nothing earned yet">Commission appears as soon as payments are recorded.</Empty> : (
              <div className="table-card table-flat">
                <table className="table">
                  <thead><tr><th>Month</th>{isAdmin && <th>Marketer</th>}<th className="num">Payments</th><th className="num">Collected</th><th className="num">Rate</th><th className="num">Commission</th></tr></thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.owner_id}-${row.month_start}`}>
                        <td data-label="Month">{monthLabel(row.month_start)}</td>
                        {isAdmin && <td data-label="Marketer">{row.marketer_name || '—'}</td>}
                        <td data-label="Payments" className="num">{row.payment_count}</td>
                        <td data-label="Collected" className="num">{naira(row.total_collected)}</td>
                        <td data-label="Rate" className="num">{Number(row.rate_percent)}%</td>
                        <td data-label="Commission" className="num money-in"><b>{naira(row.commission)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}

const bandText = (tier) => tier.upper_bound == null
  ? `${naira(tier.lower_bound)} and above`
  : `${naira(tier.lower_bound)} to ${naira(tier.upper_bound)}`

function TierTable({ tiers }) {
  return (
    <section className="panel">
      <header className="panel-head"><h2>Current rates</h2></header>
      {tiers.length === 0 ? <p className="muted">Your admin hasn’t set commission tiers yet.</p> : (
        <ul className="tier-list">
          {tiers.map((tier) => <li key={tier.id}><span>{bandText(tier)}</span><b>{Number(tier.rate_percent)}%</b></li>)}
        </ul>
      )}
    </section>
  )
}

function TierEditor({ tiers, onSaved }) {
  const toast = useToast()
  const [rows, setRows] = useState(() => tiers.length
    ? tiers.map((tier) => ({ lower_bound: String(Number(tier.lower_bound)), upper_bound: tier.upper_bound == null ? '' : String(Number(tier.upper_bound)), rate_percent: String(Number(tier.rate_percent)) }))
    : [{ lower_bound: '0', upper_bound: '', rate_percent: '' }])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)

  const update = (index, key) => (event) => setRows(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: event.target.value } : row)))

  const addTier = () => {
    const last = rows[rows.length - 1]
    const start = last?.upper_bound ? Number(last.upper_bound) + 0.01 : ''
    setRows([...rows, { lower_bound: String(start), upper_bound: '', rate_percent: '' }])
  }

  const check = (clean) => {
    if (!clean.length) return 'Add at least one tier.'
    for (const [index, row] of clean.entries()) {
      if (Number.isNaN(row.rate_percent) || row.rate_percent < 0 || row.rate_percent > 100) return `Tier ${index + 1}: the rate must be between 0 and 100.`
      if (row.upper_bound != null && row.upper_bound <= row.lower_bound) return `Tier ${index + 1}: “up to” must be more than “from”.`
      const next = clean[index + 1]
      if (next && row.upper_bound == null) return `Tier ${index + 1} has no upper limit, so it must be the last tier.`
      if (next && next.lower_bound <= row.upper_bound) return `Tiers ${index + 1} and ${index + 2} overlap.`
    }
    return null
  }

  const save = async () => {
    const clean = rows.map((row) => ({
      lower_bound: Number(row.lower_bound || 0),
      upper_bound: row.upper_bound === '' ? null : Number(row.upper_bound),
      rate_percent: Number(row.rate_percent === '' ? NaN : row.rate_percent),
    })).sort((a, b) => a.lower_bound - b.lower_bound)
    const issue = check(clean)
    setProblem(issue)
    if (issue) return
    setBusy(true)
    const { error } = await supabase.rpc('replace_commission_tiers', { new_tiers: clean.map((row) => ({ ...row, upper_bound: row.upper_bound ?? '' })) })
    setBusy(false)
    if (error) return setProblem(error.message)
    toast('Commission tiers saved — every month now uses these rates')
    onSaved()
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Commission tiers</h2>
        <button className="btn btn-small" onClick={addTier}><Icon name="plus" size={16} /> Add tier</button>
      </header>
      <p className="muted small">Leave “up to” empty on the top tier. Changes apply to every month, including past ones.</p>
      <div className="tier-editor">
        {rows.map((row, index) => (
          <div className="tier-edit-row" key={index} style={{ animationDelay: `${index * 40}ms` }}>
            <label><span>From (₦)</span><input type="number" min="0" step="any" value={row.lower_bound} onChange={update(index, 'lower_bound')} /></label>
            <label><span>Up to (₦)</span><input type="number" min="0" step="any" value={row.upper_bound} placeholder="No limit" onChange={update(index, 'upper_bound')} /></label>
            <label className="tier-rate"><span>Rate (%)</span><input type="number" min="0" max="100" step="any" value={row.rate_percent} onChange={update(index, 'rate_percent')} /></label>
            <button className="icon-btn" aria-label={`Remove tier ${index + 1}`} onClick={() => setRows(rows.filter((_, rowIndex) => rowIndex !== index))} disabled={rows.length === 1}>
              <Icon name="trash" size={17} />
            </button>
          </div>
        ))}
      </div>
      <ErrorNote>{problem}</ErrorNote>
      <div className="row end"><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save tiers'}</button></div>
    </section>
  )
}
