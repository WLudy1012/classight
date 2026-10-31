import { useTranslation } from 'react-i18next'
import { LinkButton, StateView } from '@/shared/ui'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
      <StateView
        icon="search"
        title={t('notFound.title')}
        body={t('notFound.body')}
        action={
          <LinkButton to="/" variant="secondary" icon="arrowLeft">
            {t('notFound.home')}
          </LinkButton>
        }
      />
    </div>
  )
}
