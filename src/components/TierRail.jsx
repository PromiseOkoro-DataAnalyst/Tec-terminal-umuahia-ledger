import { useEffect, useState } from 'react'
import { nairaShort, tierFor } from '../lib/format'

// A track split into commission bands; this month's total fills it.
export default function TierRail({ tiers, total, compact = false }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(total))
    return () => cancelAnimationFrame(frame)
  }, [total])

  if (!tiers.length) return null
  const { sorted, current } = tierFor(tiers, total)
  const topCap = Math.max(...sorted.map((tier) => Number(tier.upper_bound ?? tier.lower_bound)))
  const scale = Math.max(topCap * 1.3, total * 1.08, 1)
  const at = (amount) => Math.min(100, (Number(amount) / scale) * 100)

  return (
    <div className={`tier-rail ${compact ? 'tier-rail-compact' : ''}`}>
      <div className="tier-track" role="img"
        aria-label={`${nairaShort(total)} collected${current ? `, earning ${Number(current.rate_percent)}%` : ''}`}>
        {sorted.map((tier) => (
          <span key={tier.id} className={`tier-band ${current?.id === tier.id ? 'on' : ''}`}
            style={{ left: `${at(tier.lower_bound)}%`, width: `${at(tier.upper_bound ?? scale) - at(tier.lower_bound)}%` }} />
        ))}
        <span className="tier-fill" style={{ width: `${at(shown)}%` }} />
      </div>
      {!compact && (
        <div className="tier-scale" aria-hidden="true">
          {sorted.map((tier) => {
            const start = at(tier.lower_bound)
            const end = at(tier.upper_bound ?? scale)
            return (
              <span key={tier.id} className={current?.id === tier.id ? 'on' : ''} style={{ left: `${start}%`, width: `${end - start}%` }}>
                <b>{Number(tier.rate_percent)}%</b>
                <small>{tier.lower_bound > 0 ? `from ${nairaShort(Math.round(tier.lower_bound))}` : 'from ₦0'}</small>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
