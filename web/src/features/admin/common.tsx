import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/shared/i18n'
import { Button, Skeleton, StateView } from '@/shared/ui'

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="ahead">
      <div>
        <h1 className="page__title">{title}</h1>
        {sub && <p className="muted ahead__sub">{sub}</p>}
      </div>
      {actions && <div className="row-gap">{actions}</div>}
    </div>
  )
}

export function QueryBoundary({
  pending,
  error,
  onRetry,
  children,
  rows = 5,
}: {
  pending: boolean
  error: unknown
  onRetry: () => void
  children: ReactNode
  rows?: number
}) {
  const { t } = useTranslation()
  if (pending)
    return (
      <div className="stack-sm" aria-busy="true">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} h={40} />
        ))}
      </div>
    )
  if (error)
    return (
      <StateView
        icon="alert"
        title={t('common.error')}
        body={errorMessage(error)}
        action={<Button onClick={onRetry}>{t('common.retry')}</Button>}
      />
    )
  return <>{children}</>
}

export const dash = (v?: string | null) => (v ? v : '—')

/** Human label for an audit action code, in the active language. Falls back to the raw code. */
export function useActionLabel() {
  const { t } = useTranslation()
  return (action: string) => t(`admin.audit.actions.${action}`, { defaultValue: action })
}
