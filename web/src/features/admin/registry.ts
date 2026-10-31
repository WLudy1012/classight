import type { ComponentType } from 'react'
import type { Permission } from '@/shared/api'
import type { IconName } from '@/shared/ui'

/**
 * Admin modules register themselves here. Adding a back-office page means adding one
 * registration; the shell (sidebar, routing, permission filtering) never changes.
 */
export interface AdminModule {
  id: string
  group: 'overview' | 'class' | 'people' | 'site'
  order: number
  /** i18n key for the menu label and page title */
  label: string
  icon: IconName
  /** path under /admin, no leading slash; '' is the dashboard */
  path: string
  permission?: Permission
  element: ComponentType
}

const modules: AdminModule[] = []

export function registerAdminModule(m: AdminModule) {
  if (!modules.some((x) => x.id === m.id)) modules.push(m)
}

export const getAdminModules = () => [...modules].sort((a, b) => a.order - b.order)
