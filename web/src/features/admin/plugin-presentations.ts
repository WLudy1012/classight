import type { ComponentType } from 'react'

export interface PluginPresentation {
  id: string
  name: { zh: string; en: string }
  description: { zh: string; en: string }
  Settings?: ComponentType<{ readOnly: boolean }>
}

const presentations = new Map<string, PluginPresentation>()
export function registerPluginPresentation(plugin: PluginPresentation) {
  if (presentations.has(plugin.id)) throw new Error(`Duplicate plugin presentation: ${plugin.id}`)
  presentations.set(plugin.id, plugin)
}
export const pluginPresentation = (id: string) => presentations.get(id)
