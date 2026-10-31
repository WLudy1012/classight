import type { SetupStatus } from '@/shared/api'

export type StepKey = 'welcome' | 'check' | 'database' | 'admin' | 'site' | 'access' | 'speech' | 'done'

export interface StepProps {
  status: SetupStatus
  /** the one-time Setup Token the operator pasted on the welcome step */
  token: string
  /** re-read the server's setup status */
  refresh: () => unknown
  next: () => void
  back: () => void
  signedIn: boolean
}
