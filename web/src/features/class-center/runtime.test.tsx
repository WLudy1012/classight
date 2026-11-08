import { describe, expect, it } from 'vitest'
import { discoverClassCenterPlugins } from './runtime'
import { isPluginApiPath, pluginUiUrl } from './PluginFrame'
import './plugins'

describe('runtime plugin discovery', () => {
  it('removes host adapters when their DLL is no longer present', () => {
    expect(discoverClassCenterPlugins([])).toEqual([])
    expect(discoverClassCenterPlugins([{ id: 'meetings', name: 'Meetings', description: '', version: '2' }]).map((plugin) => plugin.id)).toEqual(['meetings'])
  })
  it('discovers an embedded interface without a compiled host adapter', () => {
    const plugins = discoverClassCenterPlugins([{ id: 'attendance', name: 'Attendance', description: 'Check in', version: '1', generation: 'new', workspacePath: 'attendance', uiEntry: '/api/v1/plugins/attendance/ui/index.html' }])
    expect(plugins).toHaveLength(1)
    expect(plugins[0]?.routes[0]?.path).toBe('attendance/*')
    expect(plugins[0]?.label).toBe('Attendance')
    const replaced = discoverClassCenterPlugins([{ id: 'meetings', name: 'New meetings', description: '', version: '2', workspacePath: 'meetings', uiEntry: '/api/v1/plugins/meetings/ui/index.html' }])
    expect(replaced[0]?.label).toBe('New meetings')
    expect(replaced[0]?.routes[0]?.path).toBe('meetings/*')
    expect(discoverClassCenterPlugins([{ id: 'bad', name: 'Bad', description: '', version: '1', workspacePath: 'account/security', uiEntry: '/api/v1/plugins/bad/ui/index.html' }])).toEqual([])
  })
  it('restricts UI resources and authenticated bridge requests to their own plugin', () => {
    expect(pluginUiUrl('test', '/api/v1/plugins/test/ui/index.html', '2')).toContain('generation=2')
    expect(pluginUiUrl('test', 'https://example.com/index.html')).toBeNull()
    expect(isPluginApiPath('test', '/plugins/test/api/save')).toBe(true)
    expect(isPluginApiPath('test', '/plugins/test/api/search?q=%E7%8F%AD%E4%BC%9A')).toBe(true)
    for (const path of ['/admin/users', '/plugins/other/api/save', '/plugins/test/api/../../auth', '/plugins/test/api/%2e%2e/auth', '//example.com']) expect(isPluginApiPath('test', path)).toBe(false)
  })
})
