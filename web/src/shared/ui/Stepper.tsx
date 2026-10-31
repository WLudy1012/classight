import type { ReactNode } from 'react'
import { Icon } from './Icon'
import './kit.css'

export type StepState = 'done' | 'todo' | 'error' | 'locked'

export interface StepItem {
  key: string
  label: ReactNode
  /** done: finished. todo: ahead. error: needs attention. locked: cannot be opened yet. */
  state: StepState
  /** short second line, e.g. "Connected" */
  note?: ReactNode
}

/**
 * Vertical step rail. The current step wears the four-corner bracket (the cursor mark); finished
 * steps get a check, steps with a problem a danger mark. Pass `onSelect` to make steps jump targets
 * (locked steps stay inert); without it the rail is a read-only progress list.
 */
export function Stepper({
  steps,
  current,
  onSelect,
  label,
}: {
  steps: StepItem[]
  current: string
  onSelect?: (key: string) => void
  label: string
}) {
  return (
    <ol className="stepper" aria-label={label}>
      {steps.map((s) => {
        const isCurrent = s.key === current
        const body = (
          <>
            <span className="stepper__marker" aria-hidden="true">
              {s.state === 'done' ? <Icon name="check" size={12} /> : s.state === 'error' ? <Icon name="alert" size={12} /> : <i />}
            </span>
            <span className="stepper__text">
              <span className="stepper__label">{s.label}</span>
              {s.note && <span className="stepper__note">{s.note}</span>}
            </span>
          </>
        )
        return (
          <li key={s.key} className="stepper__item" data-state={s.state} data-current={isCurrent || undefined}>
            {onSelect ? (
              <button type="button" className="stepper__btn" aria-current={isCurrent ? 'step' : undefined} disabled={s.state === 'locked'} onClick={() => onSelect(s.key)}>
                {body}
              </button>
            ) : (
              <div className="stepper__btn" aria-current={isCurrent ? 'step' : undefined}>
                {body}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
