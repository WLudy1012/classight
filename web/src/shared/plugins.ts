import { useQuery } from '@tanstack/react-query'
import { get, put } from './api/client'

export type PluginId = string
export interface PluginState { id: PluginId; enabled: boolean; dependencies?: string[] }
export interface PluginManifest { id: PluginId; name: string; description: string; version: string; workspacePath?: string | null; category?: 'class' | 'account'; permission?: string | null; icon?: string; uiEntry?: string | null; generation?: string | null }
export interface PluginRuntimeStatus { fileName: string; pluginIds: string[]; state: string; version?: string | null; error?: string | null; loadedAt?: string | null; reloadCount: number }
export interface CaptchaConfig { provider: 'cloudflare' | 'aliyun' | 'tencent'; siteKey: string; sceneId: string; region: string; accessKeyId: string; secretConfigured: boolean; appSecretConfigured: boolean }
export const pluginsApi = {
  states: () => get<Record<string, boolean>>('/plugins'),
  list: () => get<PluginState[]>('/admin/plugins'),
  catalog: () => get<PluginManifest[]>('/plugins/catalog'),
  runtime: () => get<PluginRuntimeStatus[]>('/admin/plugins/runtime'),
  set: (id: PluginId, enabled: boolean) => put<PluginState>(`/admin/plugins/${id}`, { enabled }),
  captcha: () => get<CaptchaConfig>('/admin/plugins/captcha/config'),
  saveCaptcha: (config: Omit<CaptchaConfig, 'secretConfigured' | 'appSecretConfigured'> & { secret: string; appSecret: string }) => put<CaptchaConfig>('/admin/plugins/captcha/config', config),
}
export function usePluginStates() {
  return useQuery({ queryKey: ['plugins'], queryFn: pluginsApi.states, staleTime: 2_000, refetchInterval: () => document.hidden ? false : 3_000, refetchOnWindowFocus: true })
}
export function usePluginCatalog() {
  return useQuery({ queryKey: ['plugins', 'catalog'], queryFn: pluginsApi.catalog, staleTime: 2_000, refetchInterval: () => document.hidden ? false : 3_000, refetchOnWindowFocus: true })
}
