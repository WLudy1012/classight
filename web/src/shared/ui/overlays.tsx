import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { create } from 'zustand'
import { Button } from './controls'
import { Icon } from './Icon'
import './ui.css'

/* ---------- Dialog (native <dialog>: focus trap + Esc for free) ---------- */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  flush,
  actions,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** md: forms. lg: wide content. full: nearly the whole viewport (previews). */
  size?: 'md' | 'lg' | 'full'
  /** No body padding: the content (an iframe, a slide) fills it. */
  flush?: boolean
  /** Extra controls in the header, left of the close button. */
  actions?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const { t } = useTranslation()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`dialog glass${size !== 'md' ? ` dialog--${size}` : ''}`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open && (
        <>
          <div className="dialog__head">
            <h2 className="dialog__title">{title}</h2>
            <div className="dialog__tools">
              {actions}
              <Button variant="ghost" size="sm" iconOnly icon="close" aria-label={t('common.close')} onClick={onClose} />
            </div>
          </div>
          <div className={`dialog__body${flush ? ' dialog__body--flush' : ''}`}>{children}</div>
          {footer && <div className="dialog__foot">{footer}</div>}
        </>
      )}
    </dialog>
  )
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: ReactNode
  body?: ReactNode
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  )
}

/* ---------- Toasts ---------- */
interface ToastItem {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}
const useToastStore = create<{ items: ToastItem[]; push: (k: ToastItem['kind'], m: string) => void; dismiss: (id: number) => void }>(
  (set) => ({
    items: [],
    push: (kind, message) => {
      const id = Date.now() + Math.random()
      set((s) => ({ items: [...s.items, { id, kind, message }].slice(-4) }))
      setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), kind === 'error' ? 6000 : 3500)
    },
    dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  }),
)

export const toast = {
  success: (m: string) => useToastStore.getState().push('success', m),
  error: (m: string) => useToastStore.getState().push('error', m),
  info: (m: string) => useToastStore.getState().push('info', m),
}

export function ToastHost() {
  const items = useToastStore((s) => s.items)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <div className="toasts" aria-live="polite">
      {items.map((i) => (
        <div key={i.id} className={`toast glass toast--${i.kind}`} role={i.kind === 'error' ? 'alert' : 'status'}>
          <Icon name={i.kind === 'error' ? 'alert' : i.kind === 'success' ? 'check' : 'info'} />
          <span style={{ flex: 1 }}>{i.message}</span>
          <button className="btn btn-ghost btn-sm btn-icon" aria-label="dismiss" onClick={() => dismiss(i.id)} style={{ ['--btn-h' as string]: '22px' }}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
