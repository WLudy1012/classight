import type { Article } from '@/features/blog/api'
import { getDb, newId, persist } from './db'
import { isPluginEnabled } from './plugin-state'
import type { Ctx } from './handlers'
import type { Kit } from './speech'
import { ApiError } from '../errors'

const blog = '/plugins/blog/api/posts'
const chat = '/plugins/chat/api/messages'
const missing = () => ApiError.from(404, 'resource.not_found', 'Not found')
const forbidden = () => ApiError.from(403, 'permission.denied', 'Permission denied')
const invalid = (field: string) => ApiError.from(400, 'validation.failed', 'Validation failed', { [field]: ['invalid'] })
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

function enabled(id: string) {
  if (!isPluginEnabled(id)) throw missing()
}

function text(value: unknown, field: string, max: number, required = false): string {
  if (value == null && !required) return ''
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw invalid(field)
  return value.trim()
}

function version(ctx: Ctx, supplied: unknown, expected: number) {
  const match = ctx.headers['If-Match'] ?? ctx.headers['if-match']
  const value = match === undefined ? supplied : Number(match.replace(/^"|"$/g, ''))
  if (typeof value !== 'number' || !Number.isInteger(value)) throw invalid('version')
  if (value !== expected) throw ApiError.from(409, 'resource.version_mismatch', 'Version conflict')
}

export function registerCommunityRoutes({ route, status, need, paginate, rolePermissions }: Kit) {
  const articles = () => getDb().blog ??= []
  const messages = () => getDb().chat ??= []

  function findArticle(id: string | undefined, user: string) {
    const item = articles().find((post) => post.info.id === id)
    if (!item || !item.info.publishedAt && item.info.authorId !== user) throw missing()
    return item
  }

  function save(ctx: Ctx, existing: boolean) {
    const user = need(ctx, 'blog.read', 'blog.write')
    enabled('blog')
    const old = existing ? findArticle(ctx.params.id, user.id) : undefined
    if (old && old.info.authorId !== user.id) throw forbidden()
    if (old) version(ctx, ctx.body?.version, old.info.version)
    const published = ctx.body?.published === true
    const now = new Date().toISOString()
    const article: Article = {
      info: {
        id: old?.info.id ?? newId(), authorId: user.id, authorName: old?.info.authorName ?? user.displayName,
        title: text(ctx.body?.title, 'title', 160, true), summary: text(ctx.body?.summary, 'summary', 280),
        version: (old?.info.version ?? 0) + 1, updatedAt: now, publishedAt: published ? old?.info.publishedAt ?? now : null,
      },
      body: text(ctx.body?.body, 'body', 16000, published),
    }
    if (old) articles()[articles().indexOf(old)] = article
    else articles().push(article)
    persist()
    return existing ? article : status(201, article)
  }

  route('GET', blog, (ctx) => {
    const user = need(ctx, 'blog.read')
    enabled('blog')
    const scope = ctx.query.scope ?? 'published'
    if (scope !== 'published' && scope !== 'mine' && scope !== '') throw invalid('scope')
    const search = text(ctx.query.q, 'q', 100).toLocaleLowerCase()
    const selected = articles().map(({ info }) => info)
      .filter((item) => (scope === 'mine' ? item.authorId === user.id : item.publishedAt) && [item.title, item.summary].some((value) => value.toLocaleLowerCase().includes(search)))
      .sort((a, b) => (scope === 'mine' ? b.updatedAt.localeCompare(a.updatedAt) : b.publishedAt!.localeCompare(a.publishedAt!)) || b.id.localeCompare(a.id))
    return paginate(selected, ctx.query)
  })
  route('GET', `${blog}/:id`, (ctx) => { const user = need(ctx, 'blog.read'); enabled('blog'); return findArticle(ctx.params.id, user.id) })
  route('POST', blog, (ctx) => save(ctx, false))
  route('PUT', `${blog}/:id`, (ctx) => save(ctx, true))
  route('DELETE', `${blog}/:id`, (ctx) => {
    const user = need(ctx, 'blog.read')
    enabled('blog')
    const item = findArticle(ctx.params.id, user.id)
    const perms = rolePermissions(user.roles)
    if (!(item.info.authorId === user.id && perms.includes('blog.write')) && !(item.info.publishedAt && perms.includes('blog.moderate'))) throw forbidden()
    version(ctx, ctx.query.version === undefined ? undefined : Number(ctx.query.version), item.info.version)
    articles().splice(articles().indexOf(item), 1)
    persist()
    return status(204)
  })

  route('GET', chat, (ctx) => {
    need(ctx, 'chat.read')
    enabled('chat')
    const before = ctx.query.before === undefined ? undefined : Number(ctx.query.before)
    const limit = Number(ctx.query.limit ?? 50)
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid('limit')
    const options = messages().filter((message) => before === undefined || message.id < before)
    const items = options.slice(-limit).map(({ clientId: _, ...message }) => message)
    return { items, before: options.length > limit ? items[0]!.id : null }
  })
  route('POST', chat, (ctx) => {
    const user = need(ctx, 'chat.read', 'chat.send')
    enabled('chat')
    const clientId = ctx.body?.clientId
    if (typeof clientId !== 'string' || !uuid.test(clientId) || clientId === '00000000-0000-0000-0000-000000000000') throw invalid('clientId')
    const body = text(ctx.body?.body, 'body', 2000, true)
    const all = messages()
    let stored = all.find((message) => message.senderId === user.id && message.clientId === clientId)
    if (!stored) {
      if (all.filter((message) => message.senderId === user.id && Date.parse(message.sentAt) > Date.now() - 60_000).length >= 30) throw ApiError.from(429, 'rate.limited', 'Too many messages')
      stored = { id: (all.at(-1)?.id ?? 0) + 1, clientId, senderId: user.id, senderName: user.displayName, body, sentAt: new Date().toISOString(), deleted: false }
      all.push(stored)
      persist()
    }
    const { clientId: _, ...message } = stored
    return message
  })
  route('DELETE', `${chat}/:id`, (ctx) => {
    const user = need(ctx, 'chat.read')
    enabled('chat')
    const item = messages().find((message) => message.id === Number(ctx.params.id))
    if (!item) throw missing()
    const perms = rolePermissions(user.roles)
    if (!(item.senderId === user.id && perms.includes('chat.send')) && !perms.includes('chat.moderate')) throw forbidden()
    item.body = ''
    item.deleted = true
    persist()
    return status(204)
  })
}
