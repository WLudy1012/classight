import { lazy } from 'react'
import { registerClassCenterPlugin } from '../registry'

registerClassCenterPlugin({
  id: 'blog', order: 30, label: 'blog.title', description: 'blog.description', icon: 'file', path: 'blog', permission: 'blog.read',
  routes: [{ path: 'blog/*', element: lazy(() => import('@/features/blog/BlogPage')) }],
})
