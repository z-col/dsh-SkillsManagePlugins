/**
 * dsh-skills-manager host half: the /skills JSON API that powers the web
 * management panel. Routes are fenced by the same browser-trust rule as the
 * /api gateway (Host-header loopback or the connection row's trustedHosts),
 * and every filesystem operation stays inside a known skill root.
 *
 * The API is conversation-scoped: requests carry a sessionId, and the
 * session's authoritative cwd (from the session store header) selects the
 * project root; the caller's own cwd is the fallback while the session is
 * still hydrating, and the process cwd is the last resort.
 *
 * Skill model (three levels):
 * - Skill library (<$DSH_HOME>/skill-library) — the canonical home of every
 *   skill; the only place new skills are created.
 * - User level (~/.dsh/skills) — a copy = "assigned to the user level"
 *   (global availability).
 * - Project level (<project>/.dsh/skills) — a copy = "assigned to that
 *   project". A skill can be assigned to the user level AND any number of
 *   projects at once; the project copy shadows the user copy inside that
 *   project (DSH's rank resolution prefers the lower project rank).
 */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Context } from './context-types.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import { SkillsError, readJsonBody, requireString, optionalString, writeError, writeOk } from './wire.ts'
import {
  assignmentTargetsOf,
  copySkillEntryToRoot,
  createBundleSkill,
  deleteSkillEverywhere,
  findProjectRoot,
  librarySkillsRoot,
  projectSkillsRoot,
  readProjectIndex,
  readSkillFile,
  reconcileLibrary,
  recordProjectRoot,
  recycleSkillFromRoot,
  renameSkillEverywhere,
  scanSkillsRoot,
  skillExistsInRoot,
  syncSkillEntry,
  updateSkillFile,
  userSkillsRoot,
  type SkillEntry,
  type SkillRootKind,
} from './skill-fs.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-skills-manager'

/** Services required before mounting: the webserver routes, the session store, and the loader's connection row. */
export const inject = ['webServer', 'sessions', 'loader']

/** The connection row's resolved trustedHosts (live read; the /api fence's own list). */
function trustedHostsOf(ctx: Context): string[] {
  for (const entry of ctx.loader.entries()) {
    if (entry.options.name === 'connection') {
      const config = entry.options.config as { trustedHosts?: string[] } | undefined
      return config?.trustedHosts ?? []
    }
  }
  return []
}

/** Open a directory in the OS file manager (best-effort). The directory is
 *  created first so opening a not-yet-existing project root still works.
 *  `DSH_SKILLS_NO_OPEN=1` skips the actual spawn — a test escape hatch so
 *  integration tests never pop open a real file manager window. */
async function openFolderInFileManager(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  if (process.env.DSH_SKILLS_NO_OPEN === '1') return
  const command = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'explorer'
    : 'xdg-open'
  const child = spawn(command, [path], { detached: true, stdio: 'ignore' })
  child.on('error', () => { /* best-effort open */ })
  child.unref()
}

/** Resolve a session's authoritative working directory (never throws). */
function sessionCwdOf(ctx: Context, sessionId: string, clientCwd?: string): string {
  const session = ctx.sessions.get(sessionId)
  const headerCwd = session?.header.cwd
  if (headerCwd !== undefined && headerCwd !== '') return headerCwd
  if (clientCwd !== undefined && clientCwd !== '' && isAbsolute(clientCwd)) return clientCwd
  return process.cwd()
}

/** Resolve the user skill root (validated absolute). */
function userRoot(): string {
  return resolve(userSkillsRoot())
}

/** Resolve the canonical library root (validated absolute). */
function libraryRoot(): string {
  return resolve(librarySkillsRoot())
}

/** Resolve the project skill root for a cwd (finds the git/project root first). */
async function projectRoot(cwd: string): Promise<string> {
  const root = await findProjectRoot(cwd)
  return resolve(projectSkillsRoot(root))
}

/** Root kinds the wire accepts: the two levels plus the library. */
type AnyRootKind = SkillRootKind | 'library'

/** Read `root` from a payload: 'user' | 'project' | 'library'. */
function requireAnyRoot(payload: unknown, key = 'root'): AnyRootKind {
  const value = requireString(payload, key)
  if (value !== 'user' && value !== 'project' && value !== 'library') {
    throw new SkillsError('bad-request', `${key} must be "user", "project", or "library"`)
  }
  return value
}

/** Resolve the root path for a kind + cwd. */
async function rootPathOf(kind: AnyRootKind, cwd: string): Promise<string> {
  if (kind === 'library') return libraryRoot()
  return kind === 'user' ? userRoot() : projectRoot(cwd)
}

/** The resolved skill root + cwd + kind for one request scope. */
interface RequestScope {
  kind: AnyRootKind
  root: string
  cwd: string
}

/** Build the request scope from the payload (sessionId + root + optional cwd). */
async function scopeOf(ctx: Context, payload: unknown): Promise<RequestScope> {
  const sessionId = requireString(payload, 'sessionId')
  const kind = requireAnyRoot(payload)
  const clientCwd = optionalString(payload, 'cwd')
  const cwd = sessionCwdOf(ctx, sessionId, clientCwd)
  return { kind, root: await rootPathOf(kind, cwd), cwd }
}

/** Resolve the session's project root and ensure it is recorded in the index
 *  (session-aware project discovery for the library view). */
async function sessionProject(ctx: Context, payload: unknown): Promise<{ cwd: string; project: string }> {
  const sessionId = requireString(payload, 'sessionId')
  const clientCwd = optionalString(payload, 'cwd')
  const cwd = sessionCwdOf(ctx, sessionId, clientCwd)
  const project = await findProjectRoot(cwd)
  await recordProjectRoot(project)
  return { cwd, project }
}

/** Resolve an assign/recycle target: 'user' or { project: <indexed root> }. */
async function resolveAssignTarget(value: unknown): Promise<string> {
  if (value === 'user') return userRoot()
  if (typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).project === 'string') {
    const projectRootPath = resolve((value as Record<string, unknown>).project as string)
    const projects = await readProjectIndex()
    if (!projects.some(project => project === projectRootPath)) {
      throw new SkillsError('bad-request', `project root "${projectRootPath}" is not indexed`)
    }
    return projectSkillsRoot(projectRootPath)
  }
  throw new SkillsError('bad-request', 'target must be "user" or { project }')
}

/** Find an existing entry by name in a scanned root (throws not-found). */
async function findEntry(scope: RequestScope, name: string): Promise<SkillEntry> {
  const entries = await scanSkillsRoot(scope.root)
  const entry = entries.find(candidate => candidate.name === name)
  if (entry === undefined) {
    throw new SkillsError('not-found', `skill "${name}" not found in ${scope.kind} root`, 404)
  }
  return entry
}

/** One API method dispatch table entry. */
type ApiMethod = (payload: unknown) => Promise<unknown> | unknown

/** The complete /skills API surface. */
function api(ctx: Context): Record<string, ApiMethod> {
  return {
    /** Resolve both roots + project display info for the panel header. */
    async 'roots.info'(payload: unknown): Promise<unknown> {
      const sessionId = requireString(payload, 'sessionId')
      const clientCwd = optionalString(payload, 'cwd')
      const cwd = sessionCwdOf(ctx, sessionId, clientCwd)
      const user = userRoot()
      const project = await projectRoot(cwd)
      return {
        userRoot: user,
        projectRoot: project,
        cwd,
      }
    },

    /** List skills in one level root (user or project; the library has its
     *  own method because it carries assignment metadata). */
    async 'skills.list'(payload: unknown): Promise<unknown> {
      const scope = await scopeOf(ctx, payload)
      if (scope.kind === 'library') {
        throw new SkillsError('bad-request', 'use skills.library.list for the library')
      }
      const entries = await scanSkillsRoot(scope.root)
      return entries.map(entry => ({
        name: entry.name,
        form: entry.form,
        description: entry.description,
        ...(entry.whenToUse !== undefined ? { whenToUse: entry.whenToUse } : {}),
        path: entry.path,
      }))
    },

    /** Read the full content of one skill (raw SKILL.md + parsed fields). The
     *  root may be the library canonical or a level copy. */
    async 'skills.get'(payload: unknown): Promise<unknown> {
      const scope = await scopeOf(ctx, payload)
      const name = requireString(payload, 'name')
      const entry = await findEntry(scope, name)
      const content = await readSkillFile(entry.path)
      return { ...content, path: entry.path, form: entry.form }
    },

    /** Create a new skill: the canonical bundle goes into the library, with
     *  optional immediate assignment (`assignTo: ['user' | 'project']`).
     *  No-clobber across the canonical and every target BEFORE creating, so a
     *  conflict never leaves an orphan canonical. */
    async 'skills.create'(payload: unknown): Promise<unknown> {
      const { cwd } = await sessionProject(ctx, payload)
      const name = requireString(payload, 'name')
      const description = requireString(payload, 'description')
      const whenToUse = optionalString(payload, 'whenToUse')
      const body = optionalString(payload, 'body')
      const assignToValue = (payload as Record<string, unknown>)?.assignTo
      const assignTo: Array<'user' | 'project'> = []
      if (assignToValue !== undefined) {
        if (!Array.isArray(assignToValue)) {
          throw new SkillsError('bad-request', 'assignTo must be an array of "user" | "project"')
        }
        for (const value of assignToValue as unknown[]) {
          if (value !== 'user' && value !== 'project') {
            throw new SkillsError('bad-request', 'assignTo entries must be "user" or "project"')
          }
          assignTo.push(value)
        }
      }
      const lib = libraryRoot()
      const user = userRoot()
      const project = await projectRoot(cwd)
      if (await skillExistsInRoot(lib, name)) {
        throw new SkillsError('conflict', `skill "${name}" already exists`, 409)
      }
      for (const target of assignTo) {
        const dest = target === 'user' ? user : project
        if (await skillExistsInRoot(dest, name)) {
          throw new SkillsError('conflict', `skill "${name}" already exists in the ${target} level`, 409)
        }
      }
      const entry = await createBundleSkill(lib, { name, description, ...(whenToUse !== '' ? { whenToUse } : {}), body })
      for (const target of assignTo) {
        await copySkillEntryToRoot(entry, target === 'user' ? user : project)
      }
      return { name: entry.name, path: entry.path }
    },

    /** Replace the full content of a skill file atomically. Writing a level
     *  copy also refreshes the library canonical, so the skill keeps one
     *  source of truth; other copies are refreshed via the manual 同步 action. */
    async 'skills.update'(payload: unknown): Promise<unknown> {
      const scope = await scopeOf(ctx, payload)
      const name = requireString(payload, 'name')
      const raw = requireString(payload, 'content')
      const entry = await findEntry(scope, name)
      await updateSkillFile(entry.path, raw)
      if (scope.kind !== 'library') {
        const canonical = (await scanSkillsRoot(libraryRoot())).find(candidate => candidate.name === name)
        if (canonical !== undefined && canonical.path !== entry.path) {
          await updateSkillFile(canonical.path, raw)
        }
      }
      return { ok: true }
    },

    /** Rename a skill everywhere (library canonical + all level copies),
     *  no-clobber on the new name across every location. */
    async 'skills.rename'(payload: unknown): Promise<unknown> {
      const { project } = await sessionProject(ctx, payload)
      const name = requireString(payload, 'name')
      const newName = requireString(payload, 'newName')
      const projects = await readProjectIndex()
      await renameSkillEverywhere(name, newName, projects)
      return { name: newName }
    },

    /** Delete a skill everywhere (library canonical + all level copies). */
    async 'skills.delete'(payload: unknown): Promise<unknown> {
      const { project } = await sessionProject(ctx, payload)
      const name = requireString(payload, 'name')
      const projects = await readProjectIndex()
      await deleteSkillEverywhere(name, projects)
      return { ok: true }
    },

    /** Recycle a skill from ONE level (user or project): remove that copy,
     *  keep the library canonical and every other assignment. */
    async 'skills.recycle'(payload: unknown): Promise<unknown> {
      const scope = await scopeOf(ctx, payload)
      if (scope.kind === 'library') {
        throw new SkillsError('bad-request', 'use skills.library.recycle for the library')
      }
      const name = requireString(payload, 'name')
      await recycleSkillFromRoot(name, scope.root)
      return { ok: true }
    },

    /** List the library: every canonical skill with its assignment badges,
     *  the indexed projects, and the current session's project root. Runs
     *  session-aware project discovery + library reconciliation (existing
     *  user/project skills are imported into the library on first sight). */
    async 'skills.library.list'(payload: unknown): Promise<unknown> {
      const { cwd, project } = await sessionProject(ctx, payload)
      const projects = await readProjectIndex()
      await reconcileLibrary(projects)
      const entries = await scanSkillsRoot(libraryRoot())
      const skills = await Promise.all(entries.map(async entry => ({
        name: entry.name,
        form: entry.form,
        description: entry.description,
        ...(entry.whenToUse !== undefined ? { whenToUse: entry.whenToUse } : {}),
        assignments: await assignmentTargetsOf(entry, projects),
      })))
      return {
        skills,
        projects: projects.map(root => ({ root, label: basename(root) || root })),
        currentProject: project,
      }
    },

    /** 移至 a level (user/global or an indexed project): copy the canonical
     *  there, overwriting an existing copy so the call is idempotent — the
     *  library original always wins (doubles as a refresh). */
    async 'skills.library.assign'(payload: unknown): Promise<unknown> {
      const { cwd } = await sessionProject(ctx, payload)
      const name = requireString(payload, 'name')
      const toValue = (payload as Record<string, unknown>)?.to
      const destRoot = await resolveAssignTarget(toValue)
      const canonical = (await scanSkillsRoot(libraryRoot())).find(entry => entry.name === name)
      if (canonical === undefined) {
        throw new SkillsError('not-found', `skill "${name}" not found in the library`, 404)
      }
      const copied = await copySkillEntryToRoot(canonical, destRoot, { overwrite: true })
      return { name: copied.name, path: copied.path }
    },

    /** Recycle a library skill from one assignment target ('user' or an
     *  indexed project), keeping the canonical and other assignments. */
    async 'skills.library.recycle'(payload: unknown): Promise<unknown> {
      const { cwd } = await sessionProject(ctx, payload)
      const name = requireString(payload, 'name')
      const fromValue = (payload as Record<string, unknown>)?.from
      const destRoot = await resolveAssignTarget(fromValue)
      await recycleSkillFromRoot(name, destRoot)
      return { ok: true }
    },

    /** Sync a library skill's canonical to every assigned copy (overwrite). */
    async 'skills.library.sync'(payload: unknown): Promise<unknown> {
      const { project } = await sessionProject(ctx, payload)
      const name = requireString(payload, 'name')
      const projects = await readProjectIndex()
      const canonical = (await scanSkillsRoot(libraryRoot())).find(entry => entry.name === name)
      if (canonical === undefined) {
        throw new SkillsError('not-found', `skill "${name}" not found in the library`, 404)
      }
      const targets = await syncSkillEntry(canonical, projects)
      return { ok: true, targets }
    },

    /** Open the selected level's folder in the OS file manager (library /
     *  global / project). The path is resolved server-side from the root
     *  kind — the API never opens an arbitrary client-supplied path. */
    async 'skills.openFolder'(payload: unknown): Promise<unknown> {
      const scope = await scopeOf(ctx, payload)
      await openFolderInFileManager(scope.root)
      return { ok: true, path: scope.root }
    },
  }
}

/**
 * Plugin body: mount the fenced /skills API routes.
 * @param ctx - the host cordis context.
 */
export function apply(ctx: Context): void {
  const trustedHosts = trustedHostsOf(ctx)
  const fence = (req: IncomingMessage): boolean => isTrustedApiRequest(req, trustedHosts)
  const methods = api(ctx)

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/skills',
    handler: async (req, res) => {
      if (!fence(req)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      // Method names are dotted identifiers; allow mixed case so camelCase
      // names (e.g. skills.openFolder) dispatch too.
      const match = /^\/skills\/api\/([A-Za-z0-9.]+)$/.exec(pathname)
      const method = match?.[1]
      if (method === undefined) {
        writeError(res, new SkillsError('not-found', 'unknown skills API path', 404))
        return
      }
      const handler = methods[method]
      if (handler === undefined) {
        writeError(res, new SkillsError('not-found', `unknown skills API method "${method}"`, 404))
        return
      }
      try {
        const payload = await readJsonBody(req)
        const value = await handler(payload)
        writeOk(res, value)
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-skills-manager: /skills API routes')
}

export { isTrustedApiRequest, isLoopbackHostname } from './trust-fence.ts'
export type { SkillsErrorCode } from './wire.ts'
export { SkillsError } from './wire.ts'
export type { SkillEntry, SkillRootKind, SkillFileContent, SkillCreateInput } from './skill-fs.ts'
export {
  librarySkillsRoot,
  readProjectIndex,
  recordProjectRoot,
  reconcileLibrary,
  copySkillEntryToRoot,
  recycleSkillFromRoot,
  syncSkillEntry,
  deleteSkillEverywhere,
  renameSkillEverywhere,
  skillExistsInRoot,
} from './skill-fs.ts'
