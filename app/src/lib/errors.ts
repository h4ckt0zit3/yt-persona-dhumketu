// Structured error model. Every layer (apify, embed, llm, pipeline) throws
// AppError so the API can return a JSON body the frontend can react to
// (show retry button for retryable errors, distinct copy for quota vs bug, etc.).

export type ErrorCode =
  | 'apify_failed'
  | 'embed_quota'
  | 'embed_failed'
  | 'llm_failed'
  | 'db_failed'
  | 'persona_parse_failed'
  | 'not_found'
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'upstream_unavailable'

export interface AppErrorOptions {
  status?: number
  retryable?: boolean
  context?: Record<string, unknown>
  cause?: unknown
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly retryable: boolean
  readonly context?: Record<string, unknown>

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'AppError'
    this.code = code
    this.status = options.status ?? defaultStatus(code)
    this.retryable = options.retryable ?? defaultRetryable(code)
    this.context = options.context
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      retryable: this.retryable,
      ...(this.context ? { context: this.context } : {}),
    }
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case 'unauthorized':
      return 401
    case 'forbidden':
      return 403
    case 'not_found':
      return 404
    case 'bad_request':
      return 400
    case 'embed_quota':
      return 429
    case 'upstream_unavailable':
      return 502
    default:
      return 500
  }
}

function defaultRetryable(code: ErrorCode): boolean {
  switch (code) {
    case 'apify_failed':
    case 'embed_quota':
    case 'embed_failed':
    case 'llm_failed':
    case 'persona_parse_failed':
    case 'upstream_unavailable':
      return true
    default:
      return false
  }
}

// Convenience constructor for "treat any upstream HTTP error as AppError"
export function fromHttpError(code: ErrorCode, service: string, status: number, body: string): AppError {
  const retryable = status >= 500 || status === 429
  return new AppError(code, `${service} error (${status}): ${body.slice(0, 300)}`, {
    status: status >= 500 ? 502 : 500,
    retryable,
    context: { upstream_status: status, service },
  })
}
