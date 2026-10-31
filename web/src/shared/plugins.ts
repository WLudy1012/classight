import { useQuery } from '@tanstack/react-query'
import { get, put } from './api/client'

export type PluginId = string
export interface PluginState { id: PluginId; enabled: boolean; dependencies?: string[] }
export interface CaptchaConfig { provider: 'cloudflare' | 'aliyun' | 'tencent'; siteKey: string; sceneId: string; region: string; accessKeyId: string; secretConfigured: boolean; appSecretConfigured: boolean }
export const pluginsApi = {
  states: () => get<Record<string, boolean>>('/plugins'),
  list: () => get<PluginState[]>('/admin/plugins'),
  set: (id: PluginId, enabled: boolean) => put<PluginState>(`/admin/plugins/${id}`, { enabled }),
  captcha: () => get<CaptchaConfig>('/admin/plugins/captcha/config'),
  saveCaptcha: (config: Omit<CaptchaConfig, 'secretConfigured' | 'appSecretConfigured'> & { secret: string; appSecret: string }) => put<CaptchaConfig>('/admin/plugins/captcha/config', config),
}
export function usePluginStates() {
  return useQuery({ queryKey: ['plugins'], queryFn: pluginsApi.states, staleTime: 10_000, refetchOnWindowFocus: true })
}
