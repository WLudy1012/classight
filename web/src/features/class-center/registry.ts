import type { ComponentType } from 'react'
import type { Permission } from '@/shared/api'
import type { IconName } from '@/shared/ui'

export interface ClassCenterPlugin {
  id: string
  order: number
  label: string
  description: string
  icon: IconName
  path: string
  permission?: Permission
  routes: { path: string; element: ComponentType; legacyPath?: string }[]
  DockEntry?: ComponentType
}

const plugins: ClassCenterPlugin[] = []

export function registerClassCenterPlugin(plugin: ClassCenterPlugin) {
  if (plugins.some((item) => item.id === plugin.id || item.path === plugin.path)) {
    throw new Error(`Duplicate class center plugin: ${plugin.id}`)
  }
  const paths = plugin.routes.map((route) => route.path)
  const aliases = plugin.routes.flatMap((route) => route.legacyPath ? [route.legacyPath] : [])
  const existingPaths = plugins.flatMap((item) => item.routes.map((route) => route.path))
  const existingAliases = plugins.flatMap((item) => item.routes.flatMap((route) => route.legacyPath ? [route.legacyPath] : []))
  if (new Set(paths).size !== paths.length || paths.some((path) => existingPaths.includes(path)) ||
      new Set(aliases).size !== aliases.length || aliases.some((path) => existingAliases.includes(path))) {
    throw new Error(`Duplicate class center route: ${plugin.id}`)
  }
  plugins.push(plugin)
}

export const getClassCenterPlugins = () => [...plugins].sort((a, b) => a.order - b.order)
