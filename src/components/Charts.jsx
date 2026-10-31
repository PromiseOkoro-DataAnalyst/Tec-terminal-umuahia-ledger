import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'

/* Chart colours (validated for colour-blind separation in light and dark):
   --c1 violet · --c2 orange · --c3 aqua · --c4 blue · --c5 magenta · --c6 yellow · --c-other grey.
   Every chart also writes labels and values out, so colour is never the only cue. */
export const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)']

// Keep at most `limit` slices; the rest fold into "Other"
export const foldOther = (rows, limit = 6) => {
  const sorted = [...rows].filter((row) => row.value > 0).sort((a, b) => b.value - a.value)
  if (sorted.length <= limit) return sorted.map((row, index) => ({ ...row, color: row.color || SERIES[index] }))
  const kept = sorted.slice(0, limit - 1).map((row, index) => ({ ...row, color: row.color || SERIES[index] }))
  const rest = sorted.slice(limit - 1).reduce((sum, row) => sum + row.value, 0)
  return [...kept, { key: '__other', label: 'Other', value: rest, color: 'var(--c-other)' }]
}

function useWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

// Round step for 4 gridlines: 1, 2 or 5 × 10^k, so ticks always land on round numbers
const niceStep = (value) => {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const scaled = value / power
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power
}
const niceMax = (value) => niceStep(value / 4) * 4

export function Legend({ items, format }) {
  return (
    <ul className="legend">
      {items.map((item) => (
        <li key={item.key}>
          <i style={{ background: item.color }} aria-hidden="true" />
          <span>{item.label}</span>
          {format && item.value != null && <b>{format(item.value)}</b>}
        </li>
      ))}
    </ul>
  )
}

/* ---------- Line / area chart: one or more series on ONE shared axis ---------- */
export function LineChart({ labels, shortLabels, series, format, height = 260, area = true, label }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const gradientId = useId().replace(/:/g, '')
  const pad = { top: 16, right: 16, bottom: 28, left: 52 }
  const innerW = Math.max(10, width - pad.left - pad.right)
  const innerH = height - pad.top - pad.bottom
  const max = niceMax(Math.max(0, ...series.flatMap((item) => item.values)))
  const x = (index) => pad.left + (labels.length <= 1 ? innerW / 2 : (index / (labels.length - 1)) * innerW)
  const y = (value) => pad.top + innerH - (value / max) * innerH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ratio * max)
  const every = Math.ceil(labels.length / Math.max(1, Math.floor(innerW / 54)))

  const move = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    const position = ((event.clientX - box.left) / box.width) * width
    const index = Math.round(((position - pad.left) / innerW) * (labels.length - 1))
    setHover(Math.max(0, Math.min(labels.length - 1, index)))
  }

  return (
    <figure className="chart" ref={ref} aria-label={label}>
      {series.length > 1 && <Legend items={series.map((item) => ({ key: item.key, label: item.label, color: item.color }))} />}
      {width > 0 && (
        <div className="chart-stage" style={{ height }}>
          <svg width={width} height={height} role="img" aria-label={label}
            onPointerMove={move} onPointerLeave={() => setHover(null)}>
            <defs>
              {series.map((item, index) => (
                <linearGradient key={item.key} id={`${gradientId}-${index}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={item.color} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={item.color} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((tick) => (
              <g key={tick} className="chart-grid">
                <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'baseline' : ''} />
                <text x={pad.left - 10} y={y(tick)} dy="0.32em" textAnchor="end">{format(tick)}</text>
              </g>
            ))}
            {labels.map((text, index) => (index % every === 0 || index === labels.length - 1) && (
              <text key={text + index} className="chart-axis" x={x(index)} y={height - 8} textAnchor="middle">{(shortLabels || labels)[index]}</text>
            ))}
            {series.map((item, index) => {
              const points = item.values.map((value, pointIndex) => [x(pointIndex), y(value)])
              const line = points.map(([px, py], pointIndex) => `${pointIndex ? 'L' : 'M'}${px},${py}`).join(' ')
              return (
                <g key={item.key}>
                  {area && series.length === 1 && (
                    <path className="chart-area" d={`${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${gradientId}-${index})`} />
                  )}
                  <path className="chart-line-shadow" d={line} stroke={item.color} transform="translate(0 7)" />
                  <path className="chart-line" d={line} stroke={item.color} pathLength="1" style={{ animationDelay: `${index * 180}ms` }} />
                  {points.map(([px, py], pointIndex) => (
                    <circle key={pointIndex} className={`chart-dot ${hover === pointIndex ? 'on' : ''}`} cx={px} cy={py} r={hover === pointIndex ? 5 : 3} fill={item.color} />
                  ))}
                </g>
              )
            })}
            {hover != null && <line className="chart-cross" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} />}
          </svg>
          {hover != null && (
            <div className="tip tip-float" style={{ left: Math.min(Math.max(x(hover), 80), width - 80), top: pad.top }}>
              <small>{labels[hover]}</small>
              {series.map((item) => (
                <span key={item.key} className="tip-row"><i style={{ background: item.color }} />{series.length > 1 && <em>{item.label}</em>}<b>{format(item.values[hover])}</b></span>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  )
}

/* ---------- Doughnut / pie ---------- */
const polar = (cx, cy, r, angle) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
const arcPath = (cx, cy, outer, inner, start, end) => {
  const large = end - start > Math.PI ? 1 : 0
  const [x1, y1] = polar(cx, cy, outer, start)
  const [x2, y2] = polar(cx, cy, outer, end)
  if (inner <= 0) return `M${cx},${cy} L${x1},${y1} A${outer},${outer} 0 ${large} 1 ${x2},${y2} Z`
  const [x3, y3] = polar(cx, cy, inner, end)
  const [x4, y4] = polar(cx, cy, inner, start)
  return `M${x1},${y1} A${outer},${outer} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z`
}

const shade = (color, amount = 30) => `color-mix(in srgb, ${color} ${100 - amount}%, #000)`
const tint = (color, amount = 28) => `color-mix(in srgb, ${color} ${100 - amount}%, #fff)`

// 3D doughnut / pie: the ring is tilted back and extruded, slices rise when you point at them.
export function Donut({ data, format = (value) => value, centerLabel = 'Total', pie = false, size = 220, empty = 'Nothing to show yet.' }) {
  const [active, setActive] = useState(null)
  const glossId = useId().replace(/:/g, '')
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const slices = useMemo(() => {
    let angle = -Math.PI / 2
    return data.map((item) => {
      const sweep = total ? (item.value / total) * Math.PI * 2 : 0
      const slice = { ...item, start: angle, end: angle + sweep, mid: angle + sweep / 2 }
      angle += sweep
      return slice
    })
  }, [data, total])

  if (!total) return <p className="muted small chart-empty">{empty}</p>
  const tilt = 0.6          // how far the ring leans back
  const depth = 16          // extrusion thickness in screen px
  const c = size / 2
  const outer = c - 6
  const inner = pie ? 0 : outer * 0.58
  const height = Math.round(size * tilt + depth + 22)
  const top = 10
  const focus = active != null ? slices[active] : null
  const layers = Array.from({ length: depth }, (_, index) => depth - index)
  const shapeOf = (slice) => (slice.end - slice.start >= Math.PI * 2 - 0.0001
    ? `M${c - outer},${c} a${outer},${outer} 0 1,0 ${outer * 2},0 a${outer},${outer} 0 1,0 ${-outer * 2},0 Z` +
      (inner ? ` M${c - inner},${c} a${inner},${inner} 0 1,1 ${inner * 2},0 a${inner},${inner} 0 1,1 ${-inner * 2},0 Z` : '')
    : arcPath(c, c, outer, inner, slice.start, slice.end))
  const ring = `M${c - outer},${c} a${outer},${outer} 0 1,0 ${outer * 2},0 a${outer},${outer} 0 1,0 ${-outer * 2},0 Z` +
    (inner ? ` M${c - inner},${c} a${inner},${inner} 0 1,1 ${inner * 2},0 a${inner},${inner} 0 1,1 ${-inner * 2},0 Z` : '')

  const order = [...slices.keys()].filter((index) => index !== active).concat(active != null ? [active] : [])
  const raise = (index) => (index === active ? -10 / tilt : 0)

  return (
    <div className={`donut donut-3d ${pie ? 'is-pie' : ''}`}>
      <div className="donut-figure" style={{ width: size, height }}>
        <span className="donut-floor" aria-hidden="true" />
        <svg width={size} height={height} viewBox={`0 0 ${size} ${height}`} role="img"
          aria-label={slices.map((slice) => `${slice.label} ${format(slice.value)}`).join(', ')}>
          <defs>
            <radialGradient id={glossId} cx="35%" cy="25%" r="80%">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.45" />
              <stop offset="55%" stopColor="#fff" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#000" stopOpacity="0.12" />
            </radialGradient>
          </defs>
          <g className="donut-body" transform={`translate(0 ${top}) scale(1 ${tilt})`}>
            {order.map((index) => {
              const slice = slices[index]
              const d = shapeOf(slice)
              return (
                <g key={slice.key} className="donut-slice-3d" style={{ animationDelay: `${index * 90}ms` }}
                  transform={`translate(0 ${raise(index)})`}
                  onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)}>
                  {layers.map((layer) => (
                    <path key={layer} d={d} transform={`translate(0 ${layer / tilt})`} style={{ fill: shade(slice.color, 18 + layer * 1.4) }} />
                  ))}
                  <path className="donut-top" d={d} style={{ fill: slice.color }} tabIndex={0}
                    aria-label={`${slice.label}: ${format(slice.value)}`} onFocus={() => setActive(index)} onBlur={() => setActive(null)} />
                </g>
              )
            })}
            <path d={ring} fill={`url(#${glossId})`} fillRule="evenodd" pointerEvents="none" />
          </g>
        </svg>
        {!pie && (
          <div className="donut-center" aria-hidden="true" style={{ top: top + c * tilt - 18 }}>
            <b>{format(focus ? focus.value : total)}</b>
            <small>{focus ? `${focus.label} · ${Math.round((focus.value / total) * 100)}%` : centerLabel}</small>
          </div>
        )}
      </div>
      <ul className="legend legend-stack">
        {slices.map((slice, index) => (
          <li key={slice.key} className={active === index ? 'on' : ''} onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)}>
            <i style={{ background: slice.color }} aria-hidden="true" />
            <span>{slice.label}</span>
            <b>{format(slice.value)}</b>
            <em>{Math.round((slice.value / total) * 100)}%</em>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- 3D gauge: a thick, tilted arc for a single percentage ---------- */
export function Gauge({ value, label, sub, tone = 'var(--c1)' }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(Math.max(0, Math.min(100, value || 0))))
    return () => cancelAnimationFrame(frame)
  }, [value])
  const r = 78
  const arc = `M ${100 - r} 100 A ${r} ${r} 0 0 1 ${100 + r} 100`
  const layers = [7, 6, 5, 4, 3, 2, 1]
  return (
    <figure className="gauge gauge-3d" aria-label={`${label}: ${value == null ? 'no data' : `${Math.round(value)}%`}`}>
      <svg viewBox="0 0 200 120" role="img" aria-hidden="true">
        {layers.map((layer) => (
          <path key={`t${layer}`} d={arc} className="gauge-track gauge-depth" pathLength="100" transform={`translate(0 ${layer})`} />
        ))}
        <path d={arc} className="gauge-track" pathLength="100" />
        {layers.map((layer) => (
          <path key={`v${layer}`} d={arc} className="gauge-value gauge-depth" pathLength="100" transform={`translate(0 ${layer})`}
            style={{ stroke: shade(tone, 22 + layer * 3), strokeDasharray: `${shown} 100` }} />
        ))}
        <path d={arc} className="gauge-value" pathLength="100" style={{ stroke: tone, strokeDasharray: `${shown} 100` }} />
        <path d={arc} className="gauge-gloss" pathLength="100" style={{ strokeDasharray: `${shown} 100` }} />
      </svg>
      <div className="gauge-read">
        <b>{value == null ? '—' : `${Math.round(value)}%`}</b>
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </div>
    </figure>
  )
}

/* ---------- 3D columns: front, side and top faces, values written on top ---------- */
export function Columns3D({ data, format = (value) => value, height = 250, empty = 'Nothing to show yet.', tone = 'var(--c1)' }) {
  const [ref, width] = useWidth()
  const [active, setActive] = useState(null)
  const gradientId = useId().replace(/:/g, '')
  const max = Math.max(1, ...data.map((item) => item.value))
  const padTop = 30
  const padBottom = 46
  const slot = data.length ? Math.max(0, width - 24) / data.length : 0
  const barW = Math.min(58, slot * 0.5)
  const deep = barW * 0.42
  const lift = deep * 0.55
  const floorY = height - padBottom
  const plotH = floorY - padTop - lift
  return (
    <figure className="chart columns-3d" ref={ref}>
      {!data.length ? <p className="muted small chart-empty">{empty}</p> : width > 0 && (
        <svg width={width} height={height} role="img" aria-label={data.map((item) => `${item.label} ${format(item.value)}`).join(', ')}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: tint(tone, 18) }} />
              <stop offset="100%" style={{ stopColor: shade(tone, 12) }} />
            </linearGradient>
          </defs>
          <path className="floor-3d" d={`M8,${floorY} L${width - 8 - deep},${floorY} L${width - 8},${floorY - lift} L${8 + deep},${floorY - lift} Z`} />
          {data.map((item, index) => {
            const h = Math.max(3, (item.value / max) * plotH)
            const x = 12 + slot * index + (slot - barW - deep) / 2
            const y = floorY - h
            const color = item.color || tone
            const on = active === index
            return (
              <g key={item.key} className={`col3d ${on ? 'on' : ''}`} style={{ animationDelay: `${index * 80}ms` }}
                onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} tabIndex={0}
                onFocus={() => setActive(index)} onBlur={() => setActive(null)} aria-label={`${item.label}: ${format(item.value)}`}>
                <ellipse cx={x + (barW + deep) / 2} cy={floorY - lift / 2 + 2} rx={(barW + deep) * 0.62} ry={lift * 0.7} className="col3d-shadow" />
                <path d={`M${x + barW},${y} L${x + barW + deep},${y - lift} L${x + barW + deep},${floorY - lift} L${x + barW},${floorY} Z`} style={{ fill: shade(color, 34) }} />
                <rect x={x} y={y} width={barW} height={h} style={{ fill: item.color ? color : `url(#${gradientId})` }} />
                <path d={`M${x},${y} L${x + deep},${y - lift} L${x + barW + deep},${y - lift} L${x + barW},${y} Z`} style={{ fill: tint(color, on ? 45 : 30) }} />
                <rect x={x} y={y} width={barW * 0.22} height={h} className="col3d-gloss" />
                <text x={x + (barW + deep) / 2} y={y - lift - 8} textAnchor="middle" className="col3d-value">{format(item.value)}</text>
                <text x={x + barW / 2 + deep / 2} y={floorY + 18} textAnchor="middle" className="col3d-label">
                  {item.label.length > 14 ? `${item.label.slice(0, 13)}…` : item.label}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </figure>
  )
}

/* ---------- Sparkline for stat tiles ---------- */
export function Sparkline({ values, tone = 'var(--c1)' }) {
  const gradientId = useId().replace(/:/g, '')
  if (!values?.length) return null
  const w = 120
  const h = 36
  const max = Math.max(1, ...values)
  const pts = values.map((value, index) => [values.length === 1 ? w : (index / (values.length - 1)) * w, h - 3 - (value / max) * (h - 8)])
  const line = pts.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.3" /><stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${gradientId})`} className="spark-area" />
      <path d={line} stroke={tone} className="spark-line" pathLength="1" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="2.6" fill={tone} className="spark-dot" />
    </svg>
  )
}

/* ---------- One 100% bar split into parts, with a written legend ---------- */
export function SplitBar({ data, format = (value) => value }) {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  if (!total) return <p className="muted small chart-empty">Nothing to show yet.</p>
  return (
    <div className="splitbar">
      <div className="splitbar-track" role="img" aria-label={data.map((item) => `${item.label} ${format(item.value)}`).join(', ')}>
        {data.filter((item) => item.value > 0).map((item, index) => (
          <span key={item.key} style={{ flexGrow: item.value, background: item.color, animationDelay: `${index * 90}ms` }} title={`${item.label}: ${format(item.value)}`} />
        ))}
      </div>
      <Legend items={data} format={format} />
    </div>
  )
}

/* ---------- Horizontal bars with labels and values written out ---------- */
export function BarList({ data, format = (value) => value, empty = 'Nothing to show yet.', tone = 'var(--c1)' }) {
  const max = Math.max(1, ...data.map((item) => item.value))
  if (!data.length) return <p className="muted small chart-empty">{empty}</p>
  return (
    <ul className="barlist">
      {data.map((item, index) => (
        <li key={item.key} title={`${item.label}: ${format(item.value)}`}>
          <span className="barlist-label">{item.label}</span>
          <span className="barlist-track">
            <span className="barlist-fill" style={{ width: `${Math.max(2, (item.value / max) * 100)}%`, background: item.color || tone, animationDelay: `${index * 60}ms` }} />
          </span>
          <span className="barlist-value">{format(item.value)}</span>
        </li>
      ))}
    </ul>
  )
}

/* ---------- Columns (kept for compact month views) ---------- */
export function ColumnChart({ data, format, label }) {
  const [active, setActive] = useState(null)
  const max = niceMax(Math.max(0, ...data.map((item) => item.value)))
  return (
    <figure className="chart">
      <div className="columns" role="list" aria-label={label}>
        <div className="columns-grid" aria-hidden="true">
          {[max, max / 2, 0].map((tick, index) => <span key={index}><em>{format(tick)}</em></span>)}
        </div>
        {data.map((item, index) => (
          <div key={item.key} role="listitem" tabIndex={0} className={`column ${active === index ? 'is-active' : ''}`}
            aria-label={`${item.label}: ${format(item.value)}`}
            onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}>
            <span className="column-bar" style={{ height: `${(item.value / max) * 100}%`, animationDelay: `${index * 40}ms` }} />
            <span className="column-label">{item.short || item.label}</span>
            {active === index && <span className="tip" role="tooltip"><b>{format(item.value)}</b><small>{item.label}</small></span>}
          </div>
        ))}
      </div>
    </figure>
  )
}
