/** @summary Keep native fetch receiver and a request-function test seam; no Service instances. */
export type RequestFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export type RequestFailure = Error & { readonly status: number; readonly state?: string;
  readonly relogin?: boolean; readonly outcomeUnknown?: boolean }

export function browserRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init)
}
export function requestFailure(message: string, status: number,
  detail: { readonly state?: string; readonly relogin?: boolean;
    readonly outcomeUnknown?: boolean } = {}): RequestFailure {
  return Object.assign(new Error(message), { status, ...detail })
}
export function requestStatus(value: unknown): number {
  return value instanceof Error && 'status' in value &&
    typeof value.status === 'number' ? value.status : 502
}
export function requestState(value: unknown): string {
  return value instanceof Error && 'state' in value &&
    typeof value.state === 'string' ? value.state : 'error'
}
/** @summary Fail closed after a write when transport, response, or partial completion is uncertain. */
export function uncertainWriteResult(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true
  if ('outcomeUnknown' in error && error.outcomeUnknown === true) return true
  if ('state' in error && error.state === 'partial_failure') return true
  if ('status' in error && typeof error.status === 'number') {
    return error.status >= 500 || error.status === 408 || error.status === 429
  }
  return true
}
export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ?
    value as Record<string, unknown> : null
}
export function responseObject(value: unknown, message = '服务器响应格式无效'): Record<string, unknown> {
  const result = record(value)
  if (!result) throw requestFailure(message, 502)
  return result
}
/** @summary Decode JSON once and retain structured GitHub errors without trusting unknown data. */
export async function readResponse(request: RequestFn, url: string,
  signal: AbortSignal, init: RequestInit = {}): Promise<{ readonly body: unknown; readonly response: Response }> {
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(init.method?.toUpperCase() || 'GET')
  let response: Response
  try {
    response = await request(url, { ...init, signal, credentials: 'same-origin',
      cache: 'no-store' })
  } catch (error) {
    if (!isWrite) throw error
    throw requestFailure(error instanceof Error ? error.message : '请求中断', 502,
      { outcomeUnknown: true })
  }
  let body: unknown
  try { body = await response.json() }
  catch { throw requestFailure('服务端响应格式无效', 502,
    { outcomeUnknown: isWrite }) }
  if (!response.ok) {
    const data = record(body)
    const message = typeof data?.error === 'string' ? data.error : 'HTTP ' + response.status
    throw requestFailure(message, response.status, {
      state: typeof data?.state === 'string' ? data.state : undefined,
      relogin: data?.relogin === true,
      outcomeUnknown: isWrite && (data?.outcomeUnknown === true ||
        data?.state === 'partial_failure' || response.status >= 500 ||
        response.status === 408 || response.status === 429),
    })
  }
  return { body, response }
}
