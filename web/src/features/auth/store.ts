import { create } from 'zustand'
import { api, authApi, type LoginRequest, type Permission, type RegisterRequest, type UserSelf } from '@/shared/api'

type Status = 'booting' | 'anonymous' | 'authenticated'

interface AuthState {
  status: Status
  user: UserSelf | null
  sessionLost: boolean
  /** Restore a session from the refresh cookie on page load. */
  boot: () => Promise<void>
  login: (b: LoginRequest) => Promise<void>
  register: (b: RegisterRequest) => Promise<void>
  logout: () => Promise<void>
  setUser: (u: UserSelf) => void
  clearSessionLost: () => void
}

export const useAuth = create<AuthState>((set) => ({
  status: 'booting',
  user: null,
  sessionLost: false,

  async boot() {
    try {
      const r = await authApi.refresh()
      api.setAccessToken(r.accessToken)
      const user = r.user ?? (await authApi.me())
      set({ status: 'authenticated', user })
    } catch {
      api.setAccessToken(null)
      set({ status: 'anonymous', user: null })
    }
  },

  async login(b) {
    const r = await authApi.login(b)
    api.setAccessToken(r.accessToken)
    set({ status: 'authenticated', user: r.user, sessionLost: false })
  },

  async register(b) {
    const r = await authApi.register(b)
    api.setAccessToken(r.accessToken)
    set({ status: 'authenticated', user: r.user, sessionLost: false })
  },

  async logout() {
    try {
      await authApi.logout()
    } finally {
      api.setAccessToken(null)
      set({ status: 'anonymous', user: null })
    }
  },

  setUser: (user) => set({ user }),
  clearSessionLost: () => set({ sessionLost: false }),
}))

// A 401 anywhere triggers one silent refresh; if it fails the user is signed out.
api.setRefresher(
  async () => {
    try {
      const r = await authApi.refresh()
      api.setAccessToken(r.accessToken)
      if (r.user) useAuth.getState().setUser(r.user)
      return r.accessToken
    } catch {
      return null
    }
  },
  () => {
    if (useAuth.getState().status === 'authenticated') {
      api.setAccessToken(null)
      useAuth.setState({ status: 'anonymous', user: null, sessionLost: true })
    }
  },
)

export const can = (user: UserSelf | null, permission?: Permission) =>
  !permission || !!user?.permissions.includes(permission)

export const useCan = (permission?: Permission) => useAuth((s) => can(s.user, permission))
