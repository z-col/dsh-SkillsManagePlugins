/**
 * dsh-skills-manager host half: the /skills JSON API that powers the web
 * management panel. Routes are fenced by the same browser-trust rule as the
 * /api gateway (Host-header loopback or the connection row's trustedHosts),
 * and every filesystem operation stays inside the user or project skill
 * root.
 *
 * The API is conversation-scoped: requests carry a sessionId, and the
 * session's authoritative cwd (from the session store header) selects the
 * project root; the caller's own cwd is the fallback while the session is
 * still hydrating, and the process cwd is the last resort.
 */
import { isAbsolute, join, resolve } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Context } from './context-types.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import { SkillsError, readJsonBody, requireString, optionalString, writeError, writeOk } from './wire.ts'
import {
  assertWithinRoot,
  createBundleSkill,
  deleteSkillEntry,
  findProjectRoot,
  flatSkillPath,
  moveSkillEntry,
  projectSkillsRoot,
  readSkillFile,
  renameSkillEntry,
  scanSkillsRoot,
  updateSkillFile,
  userSkillsRoot,
  bundleSkillPath,
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

/** Resolve the project skill root for a cwd (finds the git/project root first). */
async function projectRoot(cwd: string): Promise<string> {
  const root = await findProjectRoot(cwd)
  return resolve(projectSkillsRoot(root))
}

/** Read `root`/`to` from a payload: 'user' | 'project' (required). */
function requireRoot(payload: unknown, key = 'root'): SkillRootKind {
  const value = requireString(payload, key)
  if (value !== 'user' && value !== 'project') {
    throw new SkillsError('bad-request', `${key} must be "user" or "project"`)
  }
  return value
}

/** Resolve the root path for a kind + cwd. */
async function rootPathOf(kind: SkillRootKind, cwd: string): Promise<string> {
  return kind === 'user' ? userRoot() : projectRoot(cwd)
}

/** The resolved skill root + cwd + project root for one request scope. */
interface RequestScope {
  kind: SkillRootKind
  root: string
  cwd: string
}

/** Build the request scope from the payload (sessionId + root + optional cwd). */
async function scopeOf(ctx: Context, payload: unknown): Promise<RequestScope> {
  const sessionId = requireString(payload, 'sessionId')
  const kind = requireRoot(payload)
  const clientCwd = optionalString(payload, 'cwd')
  const cwd = sessionCwdOf(ctx, sessionId, clientCwd)
  return { kind, root: await rootPathOf(kind, cwd), cwd }
}

/** Resolve a bundle skill path inside a root (fence + name validation). */
function bundlePathOf(scope: RequestScope, name: string): string {
  return assertWithinRoot(scope.root, bundleSkillPath(scope.root, name))
}

/** Resolve a flat skill path inside a root (fence + name validation). */
function flatPathOf(scope: RequestScope, name: string): string {
  return assertWithinRoot(scope.root, flatSkillPath(scope.root, name))
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

    /** List skills in one root (user or project). */
    async 'skills.list'(payload: unknown): Promise<unknown> {
      const scope = await scopeOf(ctx, payload)
      const entries = await scanSkillsRoot(scope.root)
      return entries.map(entry => ({
        name: entry.name,
        form: entry.form,
        description: entry.description,
        ...(entry.whenToUse !== undefined ? { whenToUse: entry.whenToUse } : {}),
        path: entry.path,
      }))
    },

    /** Read the full content of one skill (raw SKILL.md + parsed fields). */
    async 'skills.get'(payload: unknown): Promise<unknown> {
      const scope = await scopeOf(ctx, payload)
      const name = requireString(payload, 'name')
      const entry = await findEntry(scope, name)
      const content = await readSkillFile(entry.path)
      return { ...content, path: entry.path, form: entry.form }
    },

    /** Create a new bundle skill (no-clobber). */
    async 'skills.create'(payload: unknown): Promise<unknown> {
      const scope = await scopeOf(ctx, payload)
      const name = requireString(payload, 'name')
      const description = requireString(payload, 'description')
      const whenToUse = optionalString(payload, 'whenToUse')
      const body = optionalString(payload, 'body')
      // The skill name must never escape the root (defense in depth).
      assertWithinRoot(scope.root, join(scope.root, name))
      const entry = await createBundleSkill(scope.root, { name, description, ...(whenToUse !== '' ? { whenToUse } : {}), body })
      return { name: entry.name, path: entry.path }
    },

    /** Replace the full content of a skill file atomically. */
    async 'skills.update'(payload: unknown): Promise<unknown> {
      const scope = await scopeOf(ctx, payload)
      const name = requireString(payload, 'name')
      const raw = requireString(payload, 'content')
      const entry = await findEntry(scope, name)
      await updateSkillFile(entry.path, raw)
      return { ok: true }
    },

    /** Delete a skill entry (bundle directory or flat file). */
    async 'skills.delete'(payload: unknown): Promise<unknown> {
      const scope = await scopeOf(ctx, payload)
      const name = requireString(payload, 'name')
      const entry = await findEntry(scope, name)
      await deleteSkillEntry(entry)
      return { ok: true }
    },

    /** Rename a skill entry (no-clobber on the target name). */
    async 'skills.rename'(payload: unknown): Promise<unknown> {
      const scope = await scopeOf(ctx, payload)
      const name = requireString(payload, 'name')
      const newName = requireString(payload, 'newName')
      const entry = await findEntry(scope, name)
      const next = await renameSkillEntry(entry, scope.root, newName)
      return { name: next.name, path: next.path }
    },

    /** Move a skill to the other root (user ↔ project), no-clobber. */
    async 'skills.move'(payload: unknown): Promise<unknown> {
      const scope = await scopeOf(ctx, payload)
      const name = requireString(payload, 'name')
      const to = requireRoot(payload, 'to')
      if (to === scope.kind) {
        throw new SkillsError('bad-request', 'source and destination roots are the same')
      }
      const entry = await findEntry(scope, name)
      const destRoot = to === 'user' ? userRoot() : await projectRoot(scope.cwd)
      const moved = await moveSkillEntry(entry, destRoot)
      return { name: moved.name, path: moved.path }
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
      const match = /^\/skills\/api\/([a-z0-9.]+)$/.exec(pathname)
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
export { moveSkillEntry } from './skill-fs.ts'
