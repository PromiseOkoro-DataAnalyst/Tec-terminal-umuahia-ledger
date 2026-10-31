import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon'
import { CountUp } from './ui'

// Building blocks for the Analytics dashboard: clean white cards, tinted icon
// tiles, dot-grid sparklines, stacked bars with a "now" marker, a ring donut,
// progress lists and a live feed.

// Grid of dots: one column per bucket, filled up to the bucket's value
export function DotMatrix({ values, tone = 'teal', rows = 6 }) {
  const max = Math.max(1, ...values)
  return (
    <div className={`dots dots-${tone}`} style={{ '--cols': values.length }} aria-hidden="true">
      {values.map((value, column) => {
        const filled = value > 0 ? Math.max(1, Math.round((value / max) * rows)) : 0
        return (
          <span className="dots-col" key={column} style={{ '--d': `${column * 22}ms` }}>
            {Array.from({ length: rows }, (_, row) => <i key={row} className={rows - row <= filled ? 'on' : ''} />)}
          </span>
        )
      })}
    </div>
  )
}

export function Delta({ value, goodWhenDown = false, suffix = '%' }) {
  if (value == null || !Number.isFinite(value)) return <span className="delta delta-flat">—</span>
  const up = value > 0
  const good = value === 0 ? null : up !== goodWhenDown
  return (
    <span className={`delta ${good == null ? 'delta-flat' : good ? 'delta-good' : 'delta-bad'}`}>
      <Icon name={up ? 'trendUp' : value < 0 ? 'trendDown' : 'arrowRight'} size={14} />
      {up ? '+' : ''}{Math.round(value)}{suffix}
    </span>
  )
}

export function KpiCard({ icon, tone, label, value, format, delta, goodWhenDown, series, foot }) {
  return (
    <article className={`kpi kpi-${tone}`}>
      <header className="kpi-head">
        <span className="kpi-icon"><Icon name={icon} size={18} /></span>
        <span className="kpi-label">{label}</span>
      </header>
      <div className="kpi-figure-row">
        <strong className="kpi-figure"><CountUp value={value} format={format} /></strong>
        {delta !== undefined && <Delta value={delta} goodWhenDown={goodWhenDown} />}
      </div>
      {series && <DotMatrix values={series} tone={tone} />}
      {foot && <small className="kpi-foot">{foot}</small>}
    </article>
  )
}

// Stacked columns. segments: [{ key, label, tone }], buckets: [{ key, label, values: { segKey: n } }]
export function StackedBars({ segments, buckets, nowIndex, height = 230, format = (value) => value, unit = ['', ''] }) {
  const noun = (count) => (count === 1 ? unit[0] : unit[1])
  const [hover, setHover] = useState(null)
  const totals = buckets.map((bucket) => segments.reduce((sum, segment) => sum + (bucket.values[segment.key] || 0), 0))
  const max = Math.max(1, ...totals)
  const ticks = [max, Math.round(max / 2), 0]
  const shown = hover ?? nowIndex
  return (
    <div className="sbars">
      <ul className="sbars-legend">
        {segments.map((segment) => <li key={segment.key}><i className={`sw sw-${segment.tone}`} />{segment.label}</li>)}
      </ul>
      <div className="sbars-plot" style={{ height }}>
        <div className="sbars-axis">{ticks.map((tick, index) => <span key={index}>{format(tick)}</span>)}</div>
        <div className="sbars-cols" style={{ '--n': buckets.length }} onMouseLeave={() => setHover(null)}>
          {buckets.map((bucket, index) => {
            const total = totals[index]
            return (
              <button type="button" key={bucket.key} className={`sbars-col ${index === nowIndex ? 'is-now' : ''} ${index === shown ? 'is-shown' : ''}`}
                onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)}
                aria-label={`${bucket.label}: ${total}${noun(total)}`}>
                {index === nowIndex && <span className="now-pill">Now</span>}
                <span className="sbars-stack" style={{ height: `${(total / max) * 100}%`, '--d': `${index * 45}ms` }}>
                  {total === 0 ? <i className="seg seg-empty" /> : segments.map((segment) => {
                    const value = bucket.values[segment.key] || 0
                    return value ? <i key={segment.key} className={`seg seg-${segment.tone}`} style={{ flexGrow: value }} /> : null
                  })}
                </span>
                <span className="sbars-label">{bucket.short || bucket.label}</span>
                {index === shown && total > 0 && (
                  <span className={`sbars-tip ${index > buckets.length * 0.6 ? 'tip-left' : ''}`} role="tooltip">
                    <b>{bucket.label} · {format(total)}{noun(total)}</b>
                    {segments.map((segment) => (bucket.values[segment.key] ? (
                      <span key={segment.key}><i className={`sw sw-${segment.tone}`} />{segment.label}<em>{format(bucket.values[segment.key])}</em></span>
                    ) : null))}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Flat ring with the total in the middle and a legend with amounts and shares
export function RingDonut({ data, format = (value) => value, centerLabel, empty = 'Nothing to show yet.' }) {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  if (!total) return <p className="muted small">{empty}</p>
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const starts = data.map((_, index) => data.slice(0, index).reduce((sum, item) => sum + (item.value / total) * circumference, 0))
  return (
    <div className="ring">
      <div className="ring-chart">
        <svg viewBox="0 0 140 140" role="img" aria-label={`${centerLabel}: ${format(total)}`}>
          <circle cx="70" cy="70" r={radius} className="ring-track" />
          {data.map((item, index) => {
            const length = (item.value / total) * circumference
            const gap = data.length > 1 ? 2.5 : 0
            const dash = `${Math.max(0, length - gap)} ${circumference}`
            const element = (
              <circle key={item.key} cx="70" cy="70" r={radius} className={`ring-seg stroke-${item.tone}`}
                strokeDasharray={dash} strokeDashoffset={-starts[index]} style={{ '--d': `${index * 120}ms` }} />
            )
            return element
          })}
        </svg>
        <span className="ring-center"><b>{format(total)}</b><small>{centerLabel}</small></span>
      </div>
      <ul className="ring-legend">
        {data.map((item) => (
          <li key={item.key}>
            <i className={`sw sw-${item.tone}`} />
            <span><small>{item.label}</small><b>{format(item.value)}</b></span>
            <em>{Math.round((item.value / total) * 100)}%</em>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Rows of name, "x of y" and a coloured progress bar
export function ProgressList({ rows, empty = 'Nothing yet.' }) {
  if (!rows.length) return <p className="muted small">{empty}</p>
  return (
    <ul className="plist">
      {rows.map((row, index) => (
        <li key={row.key}>
          <span className="plist-avatar" aria-hidden="true">{row.initials}</span>
          <span className="plist-main">
            <span className="plist-top"><b>{row.label}</b><small>{row.meta}</small></span>
            <span className="plist-track"><span className={`plist-fill fill-${row.tone || 'teal'}`} style={{ width: `${Math.min(100, row.percent)}%`, '--d': `${index * 80}ms` }} /></span>
          </span>
        </li>
      ))}
    </ul>
  )
}

// "Needs attention": icon, title, detail, status pill, link
export function AttentionList({ items }) {
  if (!items.length) {
    return <p className="attn-clear"><Icon name="check" size={16} /> Nothing needs attention right now.</p>
  }
  return (
    <ul className="attn">
      {items.map((item) => (
        <li key={item.key}>
          <Link to={item.to} className="attn-row">
            <span className={`attn-icon tint-${item.tone}`}><Icon name={item.icon} size={17} /></span>
            <span className="attn-text"><b>{item.title}</b><small>{item.detail}</small></span>
            <span className={`pill pill-${item.tone}`}><i />{item.status}</span>
            <Icon name="chevronRight" size={16} className="attn-go" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function Feed({ items, empty = 'No activity yet.' }) {
  if (!items.length) return <p className="muted small">{empty}</p>
  return (
    <ul className="feed">
      {items.map((item, index) => (
        <li key={item.key} style={{ '--d': `${index * 50}ms` }}>
          <span className={`feed-dot tint-${item.tone}`}>{item.initials}</span>
          <span className="feed-text"><b>{item.title}</b><small>{item.detail}</small></span>
        </li>
      ))}
    </ul>
  )
}
