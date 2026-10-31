import type { DatabaseProvider } from '@/shared/api'

export interface DbFields {
  host: string
  port: string
  database: string
  username: string
  password: string
  /** SQLite only */
  file: string
}

export const DEFAULT_PORT: Record<DatabaseProvider, string> = { PostgreSql: '5432', MySql: '3306', Sqlite: '' }

export const emptyFields = (provider: DatabaseProvider): DbFields => ({
  host: 'localhost',
  port: DEFAULT_PORT[provider],
  database: 'classight',
  username: provider === 'PostgreSql' ? 'postgres' : provider === 'MySql' ? 'root' : '',
  password: '',
  file: 'data/classight.db',
})

/** Quote a value for a `key=value;` connection string when it contains characters that would end it early. */
const quote = (v: string) => (/[;'"=\s]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** Builds the provider's connection string from the form. The password is only ever sent to the server, never echoed back. */
export function buildConnectionString(provider: DatabaseProvider, f: DbFields): string {
  if (provider === 'Sqlite') return `Data Source=${f.file.trim()}`
  const host = f.host.trim()
  const port = f.port.trim()
  if (provider === 'PostgreSql') {
    return [`Host=${host}`, port && `Port=${port}`, `Database=${f.database.trim()}`, `Username=${quote(f.username.trim())}`, `Password=${quote(f.password)}`].filter(Boolean).join(';')
  }
  return [`Server=${host}`, port && `Port=${port}`, `Database=${f.database.trim()}`, `User=${quote(f.username.trim())}`, `Password=${quote(f.password)}`].filter(Boolean).join(';')
}

/** Which required fields are still empty (the password may legitimately be empty on a local dev database). */
export function missingFields(provider: DatabaseProvider, f: DbFields): (keyof DbFields)[] {
  const need: (keyof DbFields)[] = provider === 'Sqlite' ? ['file'] : ['host', 'database', 'username']
  return need.filter((k) => !f[k].trim())
}

export type Strength = 'weak' | 'fair' | 'good' | 'strong'

/** A coarse length-and-variety score; the server's policy is the real gate. */
export function passwordStrength(pw: string): { level: Strength; score: number } {
  if (!pw) return { level: 'weak', score: 0 }
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (pw.length >= 16) score++
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  if (classes >= 3) score++
  if (classes === 4 && pw.length >= 10) score++
  const capped = Math.min(score, 4)
  return { level: (['weak', 'weak', 'fair', 'good', 'strong'] as const)[capped]!, score: capped }
}
