import { lazy } from 'react'
import { registerClassCenterPlugin } from '../registry'

registerClassCenterPlugin({
  id: 'chat', order: 40, label: 'chat.title', description: 'chat.description', icon: 'chat', path: 'chat', permission: 'chat.read',
  routes: [{ path: 'chat', element: lazy(() => import('@/features/chat/ChatPage')) }],
})
