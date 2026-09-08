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

/** A root the get/update methods accept (levels + the library canonical). */
export type SkillsLevelRoot = 'user' | 'project' | 'library'

/** An assignment target: the user level or an indexed project root. */
export type SkillsAssignTarget = 'user' | { project: string }

/** One library skill: canonical metadata plus its assignment badges. */
export interface SkillsLibraryEntry {
  name: string
  form: 'bundle' | 'flat'
  description: string
  whenToUse?: string
  /** 'user' and/or 'project:<root>' — every location holding a copy. */
  assignments: Array<'user' | `project:${string}`>
}

/** One indexed project the library knows about. */
export interface SkillsProjectRef {
  root: string
  label: string
}

/** The library list payload. */
export interface SkillsLibraryData {
  skills: SkillsLibraryEntry[]
  projects: SkillsProjectRef[]
  /** The current session's project root (for the 「当前项目」 quick target). */
  currentProject: string
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

  /** List one level root (user or project). */
  list: (scope: SkillsSessionScope, root: 'user' | 'project', signal?: AbortSignal) =>
    call<SkillsEntry[]>('skills.list', scopePayload(scope, { root }), signal),

  /** Read one skill from a level root or the library canonical. */
  get: (scope: SkillsSessionScope, root: SkillsLevelRoot, name: string, signal?: AbortSignal) =>
    call<SkillsFile>('skills.get', scopePayload(scope, { root, name }), signal),

  /** Replace the content of a skill (level copy or library canonical). */
  update: (scope: SkillsSessionScope, root: SkillsLevelRoot, name: string, content: string) =>
    call<{ ok: true }>('skills.update', scopePayload(scope, { root, name, content })),

  /** Delete a skill everywhere (library canonical + all level copies). */
  delete: (scope: SkillsSessionScope, name: string) =>
    call<{ ok: true }>('skills.delete', scopePayload(scope, { name })),

  /** Rename a skill everywhere (library canonical + all level copies). */
  rename: (scope: SkillsSessionScope, name: string, newName: string) =>
    call<{ name: string }>('skills.rename', scopePayload(scope, { name, newName })),

  /** Recycle a skill from one level (remove that copy only). */
  recycle: (scope: SkillsSessionScope, root: 'user' | 'project', name: string) =>
    call<{ ok: true }>('skills.recycle', scopePayload(scope, { root, name })),

  /** List the library (canonical skills + assignments + indexed projects). */
  libraryList: (scope: SkillsSessionScope, signal?: AbortSignal) =>
    call<SkillsLibraryData>('skills.library.list', scopePayload(scope, {}), signal),

  /** 移至 a library skill to the user/global level or the current project
   *  (copy the canonical; an existing copy is overwritten). */
  libraryAssign: (scope: SkillsSessionScope, name: string, to: SkillsAssignTarget) =>
    call<{ name: string; path: string }>('skills.library.assign', scopePayload(scope, { name, to })),

  /** Open the selected level's folder in the OS file manager. */
  openFolder: (scope: SkillsSessionScope, root: SkillsLevelRoot) =>
    call<{ ok: true; path: string }>('skills.openFolder', scopePayload(scope, { root })),
}
