import { describe, expect, it } from 'vitest'
import { buildConnectionString, emptyFields, missingFields, passwordStrength } from './connection'

describe('buildConnectionString', () => {
  it('builds a PostgreSQL string', () => {
    const f = { ...emptyFields('PostgreSql'), host: 'db.local', password: 'p@ss' }
    expect(buildConnectionString('PostgreSql', f)).toBe('Host=db.local;Port=5432;Database=classight;Username=postgres;Password=p@ss')
  })
  it('builds a MySQL string with the MySQL keywords', () => {
    const f = { ...emptyFields('MySql'), password: 'x' }
    expect(buildConnectionString('MySql', f)).toBe('Server=localhost;Port=3306;Database=classight;User=root;Password=x')
  })
  it('builds a SQLite string from the file only', () => {
    expect(buildConnectionString('Sqlite', { ...emptyFields('Sqlite'), file: ' data/a.db ' })).toBe('Data Source=data/a.db')
  })
  it('quotes values that would end the string early', () => {
    const f = { ...emptyFields('PostgreSql'), password: 'a;b="c"' }
    expect(buildConnectionString('PostgreSql', f)).toContain('Password="a;b=""c"""')
  })
  it('omits an empty port', () => {
    expect(buildConnectionString('PostgreSql', { ...emptyFields('PostgreSql'), port: '' })).not.toContain('Port=')
  })
})

describe('missingFields', () => {
  it('requires host, database and username for server databases but not the password', () => {
    expect(missingFields('PostgreSql', { ...emptyFields('PostgreSql'), host: '', username: ' ' })).toEqual(['host', 'username'])
    expect(missingFields('MySql', emptyFields('MySql'))).toEqual([])
  })
  it('requires only the file for SQLite', () => {
    expect(missingFields('Sqlite', { ...emptyFields('Sqlite'), file: '' })).toEqual(['file'])
  })
})

describe('passwordStrength', () => {
  it('ranks by length and variety', () => {
    expect(passwordStrength('').level).toBe('weak')
    expect(passwordStrength('abc').level).toBe('weak')
    expect(passwordStrength('abcdefghij').level).toBe('weak')
    expect(passwordStrength('Abcdefgh1234').level).toBe('good')
    expect(passwordStrength('Abcdefgh1234!xyz-9').level).toBe('strong')
  })
})
