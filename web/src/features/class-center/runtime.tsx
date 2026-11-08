import { type Permission } from '@/shared/api'
import { useMemo } from 'react'
import { type IconName } from '@/shared/ui'
import { usePluginCatalog, type PluginManifest } from '@/shared/plugins'
import { getClassCenterPlugins, type ClassCenterPlugin } from './registry'
import { PluginFrame, pluginUiUrl } from './PluginFrame'

const icons = new Set(['grid', 'calendar', 'mic', 'users', 'user', 'shield', 'file', 'layers', 'clock', 'web'])
export function discoverClassCenterPlugins(catalog?: PluginManifest[]): ClassCenterPlugin[] {
  if (!catalog) return getClassCenterPlugins()
  const adapters = getClassCenterPlugins()
  return catalog.flatMap<ClassCenterPlugin>((manifest, index) => {
    const adapter = adapters.find((item) => item.id === manifest.id)
    if (!manifest.uiEntry) return adapter ? [{ ...adapter, category: manifest.category ?? adapter.category, permission: (manifest.permission ?? adapter.permission) as Permission | undefined }] : []
    const path = manifest.workspacePath?.replace(/^\/?center\//, '').replace(/^\//, '')
    if (!path || !/^[a-z0-9][a-z0-9/_-]*$/i.test(path) || path === 'account' || path.startsWith('account/') || !pluginUiUrl(manifest.id, manifest.uiEntry, manifest.generation)) return []
    const element = <PluginFrame id={manifest.id} entry={manifest.uiEntry} generation={manifest.generation} title={manifest.name} />
    return [{
      id: manifest.id, order: adapter?.order ?? 100 + index, label: manifest.name, description: manifest.description,
      icon: (icons.has(manifest.icon ?? '') ? manifest.icon : 'grid') as IconName,
      path, category: manifest.category === 'account' ? 'account' : 'class', permission: manifest.permission as Permission | undefined,
      routes: [{ path: `${path}/*`, element }],
    }]
  }).sort((a, b) => a.order - b.order)
}
export function useClassCenterPlugins() {
  const catalog = usePluginCatalog()
  const plugins = useMemo(() => discoverClassCenterPlugins(catalog.data), [catalog.data])
  return { catalog, plugins }
}
