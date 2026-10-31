import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { setLanguage } from '@/shared/i18n'
import { useClassName, useSite } from '@/shared/site'
import { Button } from '@/shared/ui'
import './page-shell.css'

/** Frame for the plain 2D pages (auth, class page). Brand left, language right. */
export function PageShell({ children, back }: { children: ReactNode; back?: boolean }) {
  const { t, i18n } = useTranslation()
  const site = useSite().data
  const name = useClassName(site)
  const other = i18n.language === 'en' ? 'zh' : 'en'
  return (
    <div className="shell">
      <header className="shell__bar">
        <Link to="/" className="shell__brand" aria-label={back ? t('home.back') : name}>
          <span className="shell__mark" aria-hidden="true" />
          {name}
        </Link>
        <Button variant="ghost" size="sm" icon="globe" onClick={() => setLanguage(other)}>
          {other === 'en' ? 'EN' : '中文'}
        </Button>
      </header>
      {children}
    </div>
  )
}
