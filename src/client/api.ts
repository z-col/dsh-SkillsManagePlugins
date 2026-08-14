/**
 * Typed fetch wrapper over the /skills JSON API. Every call posts to
 * `/skills/api/<method>` with the sessionId and — when known — the session's
 * cwd from the client's own list summary. Failures surface as
 * {@link SkillsApiError} with the wire code.
 */

/** One wire failure. */
export class SkillsApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** One skill entry as the host lists it. */
export interface SkillsEntry {
  name: string
  form: 'bundle' | 'flat'
  description: string
  whenToUse?: string
  path: string
}

/** The full skill file as the host reads it. */
export interface SkillsFile extends SkillsEntry {
  raw: string
  body: string
}

/** Root info for the panel header. */
export interface SkillsRootsInfo {
  userRoot: string
  projectRoot: string
  cwd: string
}

/** One request's session scope: the conversation id plus its cwd when known. */
export interface SkillsSessionScope {
  sessionId: string
  /** The session's working directory from the client list summary (optional). */
  cwd?: string
}

/** Fold a scope into a JSON payload ({cwd} only when present). */
function scopePayload(scope: SkillsSessionScope, extra: Record<string, unknown>): Record<string, unknown> {
  return { sessionId: scope.sessionId, ...(scope.cwd !== undefined && scope.cwd !== '' ? { cwd: scope.cwd } : {}), ...extra }
}

async function call<T>(method: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/skills/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    throw new SkillsApiError('network', error instanceof Error ? error.message : String(error))
  }
  const parsed: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } | null
    = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new SkillsApiError(
      parsed?.error?.code ?? 'http',
      parsed?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed.value as T
}

/** The skills API surface (session scope threaded through every call). */
export const api = {
  rootsInfo: (scope: SkillsSessionScope, signal?: AbortSignal) =>
    call<SkillsRootsInfo>('roots.info', scopePayload(scope, {}), signal),
  list: (scope: SkillsSessionScope, root: 'user' | 'project', signal?: AbortSignal) =>
    call<SkillsEntry[]>('skills.list', scopePayload(scope, { root }), signal),
  get: (scope: SkillsSessionScope, root: 'user' | 'project', name: string, signal?: AbortSignal) =>
    call<SkillsFile>('skills.get', scopePayload(scope, { root, name }), signal),
  create: (scope: SkillsSessionScope, root: 'user' | 'project', input: {
    name: string
    description: string
    whenToUse?: string
    body?: string
  }) =>
    call<{ name: string; path: string }>('skills.create', scopePayload(scope, { root, ...input })),
  update: (scope: SkillsSessionScope, root: 'user' | 'project', name: string, content: string) =>
    call<{ ok: true }>('skills.update', scopePayload(scope, { root, name, content })),
  delete: (scope: SkillsSessionScope, root: 'user' | 'project', name: string) =>
    call<{ ok: true }>('skills.delete', scopePayload(scope, { root, name })),
  rename: (scope: SkillsSessionScope, root: 'user' | 'project', name: string, newName: string) =>
    call<{ name: string; path: string }>('skills.rename', scopePayload(scope, { root, name, newName })),
  move: (scope: SkillsSessionScope, root: 'user' | 'project', name: string, to: 'user' | 'project') =>
    call<{ name: string; path: string }>('skills.move', scopePayload(scope, { root, name, to })),
}
