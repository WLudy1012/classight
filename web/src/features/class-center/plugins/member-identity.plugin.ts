import { lazy } from 'react'
import { registerClassCenterPlugin } from '../registry'

registerClassCenterPlugin({
  id: 'member-identity',
  order: 20,
  label: 'memberIdentity.title',
  description: 'memberIdentity.description',
  icon: 'shield',
  path: 'identity',
  category: 'account',
  routes: [{ path: 'identity', element: lazy(() => import('@/features/member-identity/MemberIdentityPage')) }],
})
