import type { ProblemDetails } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly errors?: Record<string, string[]>
  readonly traceId?: string

  constructor(p: Pick<ProblemDetails, 'status' | 'code' | 'detail' | 'title' | 'errors' | 'traceId'>) {
    super(p.detail ?? p.title ?? p.code)
    this.name = 'ApiError'
    this.status = p.status
    this.code = p.code
    this.errors = p.errors
    this.traceId = p.traceId
  }

  static from(status: number, code: string, detail?: string, errors?: Record<string, string[]>) {
    return new ApiError({ status, code, detail, errors })
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError
