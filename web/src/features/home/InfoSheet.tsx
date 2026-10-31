import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ClassInfoView } from '@/features/class-info/ClassInfoView'
import { Button } from '@/shared/ui'

interface Props {
  open: boolean
  onClose: () => void
  scrollerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * The class information sheet. It is always laid out at its final place; the home frame loop
 * reveals it by clipping it to the cursor bracket as the bracket opens.
 */
export const InfoSheet = forwardRef<HTMLElement, Props>(function InfoSheet({ open, onClose, scrollerRef }, ref) {
  const { t } = useTranslation()
  return (
    <section
      ref={ref}
      className="sheet glass"
      aria-label={t('info.title')}
      // `inert` keeps the closed sheet out of the tab order and the accessibility tree
      inert={!open}
      data-open={open}
    >
      <div className="sheet__bar">
        <h2 className="sheet__title">{t('info.title')}</h2>
        <Button variant="ghost" size="sm" icon="arrowUp" onClick={onClose}>
          {t('info.close')}
        </Button>
      </div>
      <div ref={scrollerRef} className="sheet__scroll">
        <ClassInfoView
          footer={
            <Link className="btn btn-secondary btn-sm" to="/class">
              {t('info.membersAll')} / {t('info.timelineAll')}
            </Link>
          }
        />
      </div>
    </section>
  )
})
