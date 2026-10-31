import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageShell } from '@/app/PageShell'
import { useDocumentTitle } from '@/shared/hooks'
import { errorMessage } from '@/shared/i18n'
import { Button, Icon, Skeleton, StateView } from '@/shared/ui'
import { useMemberPermissions } from './permissions'

export default function MemberIdentityPage() {
  const { t } = useTranslation()
  useDocumentTitle(t('memberIdentity.title'))
  const query = useMemberPermissions()
  return (
    <PageShell back>
      <main className="center page">
        <Link to="/center" className="btn btn-ghost btn-sm center__back"><Icon name="arrowLeft" /> {t('center.title')}</Link>
        <h1 className="page__title">{t('memberIdentity.title')}</h1>
        <p className="page__sub">{t('memberIdentity.explanation')}</p>
        <section className="page__section">
          <h2 className="page__h">{t('memberIdentity.currentPermissions')}</h2>
          {query.isPending && <Skeleton w="100%" h={44} />}
          {query.isError && <StateView icon="alert" title={t('common.error')} body={errorMessage(query.error)} action={<Button onClick={() => void query.refetch()}>{t('common.retry')}</Button>} />}
          {query.data && (query.data.permissions.length ? <ul>{query.data.permissions.map((permission) => <li key={permission}>{permission}</li>)}</ul> : <p>{t('memberIdentity.empty')}</p>)}
        </section>
      </main>
    </PageShell>
  )
}
