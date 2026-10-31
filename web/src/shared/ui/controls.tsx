import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Icon, type IconName } from './Icon'
import './ui.css'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const cls = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ')

/* ---------- Button ---------- */
interface ButtonBase {
  variant?: Variant
  size?: Size
  icon?: IconName
  iconRight?: IconName
  loading?: boolean
  iconOnly?: boolean
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonBase {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading, iconOnly, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cls('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, iconOnly && 'btn-icon', className)}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} />}
      {children}
      {iconRight && !loading && <Icon name={iconRight} />}
    </button>
  )
})

export interface LinkButtonProps extends LinkProps, ButtonBase {}

export function LinkButton({ variant = 'secondary', size = 'md', icon, iconRight, iconOnly, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link className={cls('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, iconOnly && 'btn-icon', className)} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </Link>
  )
}

/* ---------- Form controls ---------- */
interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: string
  children: ReactNode
  className?: string
}

/** Label wraps the control, so association needs no ids. */
export function Field({ label, hint, error, children, className }: FieldProps) {
  return (
    <label className={cls('field', className)}>
      <span className="field__label">{label}</span>
      {children}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="field__hint">{hint}</span>
      )}
    </label>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return <input ref={ref} className={cls('input', className)} aria-invalid={invalid || undefined} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ invalid, className, ...rest }, ref) {
    return <textarea ref={ref} className={cls('textarea', className)} aria-invalid={invalid || undefined} {...rest} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...rest },
  ref,
) {
  return <select ref={ref} className={cls('select', className)} {...rest} />
})

export function Switch({
  label,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" {...rest} />
      <span>{label}</span>
    </label>
  )
}

export function Checkbox({ label, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  )
}

/* ---------- Display ---------- */
export function Badge({ tone, children }: { tone?: 'success' | 'danger' | 'solid'; children: ReactNode }) {
  return <span className={cls('badge', tone && `badge-${tone}`)}>{children}</span>
}

const hue = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return 190 + (h % 70) // cool band only: stays inside the ink palette
}

export function Avatar({ name, src, size = 36 }: { name: string; src?: string; size?: number }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '·'
  return (
    <span
      className="avatar"
      style={{ ['--size' as string]: `${size}px`, background: src ? 'var(--bg-800)' : `hsl(${hue(name)} 34% 86%)` }}
      aria-hidden={src ? undefined : 'true'}
    >
      {src ? <img src={src} alt={name} /> : initial}
    </span>
  )
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'status' : undefined} aria-label={label} />
}

export function Skeleton({ w = '100%', h = 16, style }: { w?: number | string; h?: number | string; style?: React.CSSProperties }) {
  return <span className="skeleton" style={{ width: w, height: h, ...style }} aria-hidden="true" />
}

export function StateView({
  icon,
  title,
  body,
  action,
}: {
  icon?: IconName
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="state" role="status">
      {icon && <Icon name={icon} size={28} />}
      <div className="state__title">{title}</div>
      {body && <p className="state__body">{body}</p>}
      {action}
    </div>
  )
}

/* ---------- Pagination ---------- */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
}) {
  const { t } = useTranslation()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="pagination">
      <span className="num">{t('common.pagination.total', { count: total })}</span>
      <div className="pagination__nav">
        <Button size="sm" variant="ghost" iconOnly icon="chevronLeft" aria-label={t('common.prev')} disabled={page <= 1} onClick={() => onPage(page - 1)} />
        <span className="num">
          {page} / {pages}
        </span>
        <Button size="sm" variant="ghost" iconOnly icon="chevronRight" aria-label={t('common.next')} disabled={page >= pages} onClick={() => onPage(page + 1)} />
      </div>
    </div>
  )
}
