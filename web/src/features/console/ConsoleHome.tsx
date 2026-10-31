import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { meApi } from '@/shared/api'
import { errorMessage } from '@/shared/i18n'
import { Avatar, Badge, Button, Icon, Skeleton, StateView, type IconName } from '@/shared/ui'

const ICONS: Record<string, IconName> = {
  profile: 'user',
  security: 'shield',
  class: 'users',
  admin: 'sliders',
  'admin-users': 'users',
  center: 'grid',
}

export function ConsoleHome() {
  const { t } = useTranslation()
  const q = useQuery({ queryKey: ['me', 'console'], queryFn: meApi.console })

  if (q.isPending)
    return (
      <div className="page">
        <Skeleton w={260} h={32} />
        <Skeleton w="100%" h={120} style={{ marginTop: 24 }} />
      </div>
    )
  if (q.isError)
    return (
      <StateView
        icon="alert"
        title={t('common.error')}
        body={errorMessage(q.error)}
        action={<Button onClick={() => void q.refetch()}>{t('common.retry')}</Button>}
      />
    )

  const { user, linkedMember, shortcuts } = q.data
  return (
    <div className="page">
      <h1 className="page__title">{t('console.welcome', { name: user.displayName })}</h1>
      <p className="page__sub">
        {user.roles.map((r) => (
          <Badge key={r}>{r}</Badge>
        ))}
      </p>

      <section className="page__section" aria-labelledby="c-member">
        <h2 id="c-member" className="page__h">
          {t('console.linkedMember')}
        </h2>
        {linkedMember ? (
          <div className="rowline">
            <Avatar name={linkedMember.displayName} src={linkedMember.avatarUrl} size={40} />
            <div>
              <strong>{linkedMember.displayName}</strong>
              {linkedMember.title && <span className="muted"> · {linkedMember.title}</span>}
            </div>
          </div>
        ) : (
          <p className="muted">{t('console.notLinked')}</p>
        )}
      </section>

      <section className="page__section" aria-labelledby="c-short">
        <h2 id="c-short" className="page__h">
          {t('console.shortcuts')}
        </h2>
        <ul className="links">
          {shortcuts.map((s) => (
            <li key={s.key}>
              <Link to={s.route}>
                <Icon name={ICONS[s.key] ?? 'chevronRight'} />
                <span>{t(s.label)}</span>
                <Icon name="arrowRight" size={16} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
