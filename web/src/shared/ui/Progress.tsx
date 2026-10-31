import type { ReactNode } from 'react'
import './kit.css'

/** Thin ink bar. `value` is 0..1; leave it out for an indeterminate wait. Never coral: that is for actions. */
export function Progress({
  value,
  label,
  tone,
  trailing,
}: {
  value?: number
  label: string
  tone?: 'danger' | 'success'
  trailing?: ReactNode
}) {
  const pct = value === undefined ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div className="progress" data-tone={tone}>
      <div
        className="progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span className="progress__bar" data-indeterminate={pct === undefined || undefined} style={pct === undefined ? undefined : { width: `${pct}%` }} />
      </div>
      <span className="progress__text num">{trailing ?? (pct === undefined ? '' : `${pct}%`)}</span>
    </div>
  )
}
