import { useTranslation } from 'react-i18next'
import { useClassOverview } from '@/features/class-info/ClassInfoView'
import { Icon, type IconName } from '@/shared/ui'

interface Props {
  visible: boolean
  /** open the class sheet, optionally scrolled to a section id */
  onOpen: (sectionId?: string) => void
}

/**
 * Entrances under the name. Three plain cells in one pane, each a snap target: the numbers come
 * from the same overview the sheet uses, so the dock and the sheet never disagree.
 */
export function HomeDock({ visible, onOpen }: Props) {
  const { t } = useTranslation()
  const q = useClassOverview()
  const s = q.data?.stats
  const cells: { id?: string; icon: IconName; label: string; value: string; to?: string }[] = [
    { icon: 'info', label: t('info.title'), value: q.data ? q.data.profile.motto : '—' },
    { id: 'ci-members', icon: 'users', label: t('info.members'), value: s ? `${s.memberCount} ${t('info.stats.members')}` : '—' },
    { id: 'ci-timeline', icon: 'timeline', label: t('info.timeline'), value: s ? `${s.timelineCount} ${t('info.stats.events')}` : '—' },
  ]
  return (
    <nav className="dock glass" aria-label={t('info.title')} inert={!visible}>
      {cells.map((c) => (
        <button key={c.label} className="dock__cell" data-magnet data-magnet-pad="4" data-magnet-radius="40" onClick={() => onOpen(c.id)}>
          <span className="dock__label">
            <Icon name={c.icon} size={15} /> {c.label}
          </span>
          <span className="dock__value num">{c.value}</span>
          <Icon name="arrowRight" size={16} className="dock__go" />
        </button>
      ))}
    </nav>
  )
}
