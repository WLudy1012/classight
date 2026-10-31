import { lazy } from 'react'
import { registerClassCenterPlugin } from '../registry'

registerClassCenterPlugin({
  id: 'timetable', order: 20, label: 'timetable.title', description: 'timetable.description', icon: 'calendar', path: 'timetable',
  routes: [{ path: 'timetable', element: lazy(() => import('@/features/timetable/TimetablePage')) }],
})
