import { beforeEach, expect, it } from 'vitest'
import { api, authApi, speechApi } from '..'
import { pluginsApi } from '@/shared/plugins'
import { resetDb } from './db'
import { mockTransport } from './transport'

beforeEach(() => {
  localStorage.clear()
  resetDb()
  api.setTransport(mockTransport(0))
  api.setAccessToken(null)
  api.setRefresher(async () => null, () => {})
})

it('enforces plugin management permission and disables meeting APIs', async () => {
  const student = await authApi.login({ account: 'student', password: 'Student123!' })
  api.setAccessToken(student.accessToken)
  await expect(pluginsApi.set('meetings', false)).rejects.toMatchObject({ status: 403 })
  const admin = await authApi.login({ account: 'admin', password: 'Admin123!' })
  api.setAccessToken(admin.accessToken)
  await pluginsApi.set('meetings', false)
  expect((await pluginsApi.states()).meetings).toBe(false)
  await expect(speechApi.sessions()).rejects.toMatchObject({ status: 404 })
  await pluginsApi.set('meetings', true)
  await expect(speechApi.sessions()).resolves.toHaveProperty('items')
})

it('does not enable a simulated captcha without real verification', async () => {
  const admin = await authApi.login({ account: 'admin', password: 'Admin123!' })
  api.setAccessToken(admin.accessToken)
  await expect(pluginsApi.set('captcha', true)).rejects.toMatchObject({ status: 400 })
  expect((await pluginsApi.states()).captcha).toBe(false)
})
