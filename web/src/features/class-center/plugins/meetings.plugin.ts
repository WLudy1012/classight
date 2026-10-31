import { lazy } from 'react'
import { registerClassCenterPlugin } from '../registry'
import { MeetingDockEntry } from './meeting-dock'

registerClassCenterPlugin({
  id: 'meetings',
  order: 10,
  label: 'queue.title',
  description: 'center.meetingsDescription',
  icon: 'mic',
  path: 'meetings',
  routes: [
    { path: 'meetings', legacyPath: '/queue', element: lazy(() => import('@/features/queue/QueuePages').then((m) => ({ default: m.QueueListPage }))) },
    { path: 'meetings/:sessionId', legacyPath: '/queue/:sessionId', element: lazy(() => import('@/features/queue/QueuePages').then((m) => ({ default: m.QueueSessionPage }))) },
  ],
  DockEntry: MeetingDockEntry,
})
