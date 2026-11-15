import type { Page } from '@/shared/api'
import { del, get, post, put } from '@/shared/api/client'

export interface ArticleSummary {
  id: string
  authorId: string
  authorName: string
  title: string
  summary: string
  updatedAt: string
  publishedAt: string | null
  version: number
}

export interface Article { info: ArticleSummary; body: string }
export interface ArticleInput { title: string; summary: string; body: string; published: boolean; version?: number }

const path = '/plugins/blog/api/posts'
export const blogApi = {
  list: (scope: 'published' | 'mine', q: string, page: number, signal?: AbortSignal) => get<Page<ArticleSummary>>(path, { scope, q, page, pageSize: 12 }, signal),
  read: (id: string, signal?: AbortSignal) => get<Article>(`${path}/${id}`, undefined, signal),
  save: (id: string | undefined, input: ArticleInput) => id ? put<Article>(`${path}/${id}`, input) : post<Article>(path, input),
  remove: (item: ArticleSummary) => del(`${path}/${item.id}`, { query: { version: item.version } }),
}
