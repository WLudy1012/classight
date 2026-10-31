import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import './kit.css'

export interface TabItem<K extends string = string> {
  key: K
  label: ReactNode
  icon?: IconName
  /** small count after the label */
  count?: number
  disabled?: boolean
}

/**
 * Accessible tab list (WAI-ARIA tabs pattern): one tab stop, arrow keys / Home / End move and select.
 * Pair every tab with a `<TabPanel>` using the same `idBase`.
 */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  idBase,
  label,
  className,
}: {
  tabs: TabItem<K>[]
  value: K
  onChange: (key: K) => void
  /** Same value goes to the matching TabPanel so aria-controls / labelledby line up. */
  idBase: string
  label: string
  className?: string
}) {
  const refs = useRef(new Map<K, HTMLButtonElement>())
  const enabled = tabs.filter((t) => !t.disabled)

  const move = (e: KeyboardEvent, from: K) => {
    const i = enabled.findIndex((t) => t.key === from)
    let next: TabItem<K> | undefined
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(i + 1) % enabled.length]
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = enabled[(i - 1 + enabled.length) % enabled.length]
    else if (e.key === 'Home') next = enabled[0]
    else if (e.key === 'End') next = enabled[enabled.length - 1]
    if (!next) return
    e.preventDefault()
    onChange(next.key)
    refs.current.get(next.key)?.focus()
  }

  return (
    <div className={`tabs${className ? ` ${className}` : ''}`} role="tablist" aria-label={label}>
      {tabs.map((t) => {
        const selected = t.key === value
        return (
          <button
            key={t.key}
            ref={(el) => {
              if (el) refs.current.set(t.key, el)
              else refs.current.delete(t.key)
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${t.key}`}
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${t.key}`}
            tabIndex={selected ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => move(e, t.key)}
          >
            {t.icon && <Icon name={t.icon} size={16} />}
            {t.label}
            {t.count !== undefined && <span className="tabs__count num">{t.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({ idBase, tabKey, value, children }: { idBase: string; tabKey: string; value: string; children: ReactNode }) {
  if (tabKey !== value) return null
  return (
    <div role="tabpanel" id={`${idBase}-panel-${tabKey}`} aria-labelledby={`${idBase}-tab-${tabKey}`} tabIndex={0} className="tabpanel">
      {children}
    </div>
  )
}

/** Stable id base for a Tabs/TabPanel pair. */
export const useTabsId = () => useId().replace(/:/g, '')
