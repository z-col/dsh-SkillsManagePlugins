/**
 * Structural types for the cordis services this plugin consumes, plus the
 * Context augmentation both halves share. A third-party plugin resolves
 * outside the DSH monorepo's single cordis instance, so the upstream
 * `declare module` augmentations do not reach this Context — and the npm
 * cordis package does not declare the DSH-vendored runtime members
 * (`ctx.effect`, service properties). The members below mirror the actual
 * runtime shapes this plugin touches:
 * - webServer: @deepseek-ai/dsh-host-webserver (the WebServer)
 * - sessions: host side @deepseek-ai/dsh-session (SessionStore), client
 *   side the runtime ISessions list feed
 * - loader: @cordisjs/plugin-loader (entry options, trustedHosts)
 * - skills: @deepseek-ai/dsh-skill (SkillRegistry) — host half
 * - slots: the client runtime SlotRegistry
 * - locale: @deepseek-ai/dsh-client-locale
 * - effect: the DSH-vendored cordis lifecycle helper
 * Drift from upstream is contained to this file.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'

/** One named webserver route (mirror of the host-webserver WebRoute). */
export interface SkillsWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** The webServer service face this plugin uses. */
export interface SkillsWebServer {
  register(route: SkillsWebRoute): () => void
}

/** A published session's header slice the host reads (authoritative cwd). */
export interface SkillsSessionHeader {
  cwd?: string
}

/** The host session store face (`ctx.sessions.get(id)` returns the live session). */
export interface SkillsSessionStore {
  get(id: string): { header: SkillsSessionHeader } | undefined
}

/** One loader entry's options slice (the connection row's resolved config). */
export interface SkillsLoaderEntry {
  options: { name: string; config?: unknown }
}

/** The loader face used to read the connection row's trustedHosts config. */
export interface SkillsLoader {
  entries(): Iterable<SkillsLoaderEntry>
}

/** One session row as the client feed publishes it (only the facts the panel reads). */
export interface SkillsClientSessionSummary {
  id: string
  cwd?: string
  displayTitle?: string
}

/**
 * The client sessions list feed face. The session the manager manages is NOT
 * derived from this feed — the session-scoped `conversation.view` seat hands the
 * view its own SessionId, which is also why the panel survives DSH 0.2 dropping
 * the feed's old `current` selection field. Only the row's `cwd` (the API's
 * fallback scope while the host session hydrates) is read here.
 */
export interface SkillsClientSessionList {
  byId: Record<string, SkillsClientSessionSummary>
}

/** The client sessions service face (only the list feed is needed). */
export interface SkillsClientSessionsService {
  list: {
    getSnapshot(): SkillsClientSessionList
    subscribe(fn: () => void): () => void
  }
}

/** Registration options the client passes to `ctx.slots.register` (subset of the real options). */
export interface SkillsSlotRegisterOptions {
  name: string
  key?: string
  id?: string
  order?: number
  label?: string | (() => string)
  priority?: number
  locale?: string
  registrant?: string
  /**
   * Business-face factory; args depend on the slot scope. The session-scoped
   * form (`conversation.view`) receives that instance's SessionId first.
   */
  inject?: (sessionId: string) => Record<string, unknown>
  children?: Record<string, unknown>
}

/** The client slots service face (register returns the disposer). */
export interface SkillsSlotsService {
  register(options: SkillsSlotRegisterOptions, component: unknown): () => void
  /**
   * Run a callback for each declaration lifetime of a slot (the runtime
   * SlotRegistry.inject): a no-op while the slot is undeclared.
   */
  inject(key: string, callback: () => () => void): () => void
}

/** The client locale registry face (register returns the disposer). */
export interface SkillsLocaleService {
  /** Current immutable locale snapshot (uSES-safe; `active` is 'zh' | 'en' today). */
  getSnapshot(): { active: string }
  /** Subscribe to snapshot changes (locale switch or dictionary registration). */
  subscribe(fn: () => void): () => void
  /** Register one locale's dictionary for a namespace; returns the disposer. */
  register(namespace: string, language: string, dictionary: Record<string, string>): () => void
}

declare module 'cordis' {
  interface Context {
    /** The webserver route registry (host half). */
    webServer: SkillsWebServer
    /** The host session store (host half) and client list feed (client half). */
    sessions: SkillsSessionStore & SkillsClientSessionsService
    /** The plugin loader (host half). */
    loader: SkillsLoader
    /** The client slots service (client half). */
    slots: SkillsSlotsService
    /** The client locale service (client half). */
    locale: SkillsLocaleService
    /**
     * Register a lifecycle callback (DSH-vendored cordis): runs at plugin
     * activation; its returned cleanup runs at disposal.
     */
    effect(fn: () => void | (() => void), label?: string): void
    /**
     * Run a callback once the requested services are available (DSH-vendored
     * cordis): unloaded and re-run whenever a required service changes.
     */
    inject(
      deps: string[] | Record<string, unknown>,
      callback: (ctx: Context) => void | (() => void),
    ): unknown
    /**
     * Read a service value without the inject requirement (core cordis):
     * returns `undefined` while the service is not (yet) provided.
     */
    get<T = unknown>(name: string): T | undefined
    /**
     * Register an event listener (core cordis); returns the disposer.
     * Service provide/unload surfaces through the `internal/service` event
     * with `(name, value)` — `value` is the service when provided, undefined
     * when unloaded.
     */
    on(event: string, listener: (...args: unknown[]) => void): () => void
  }
}

export type { Context }
