/**
 * Skills manager panel state: a tiny per-activation store (the official
 * createXXXStore() factory rule — production code creates it only inside
 * apply(), then hands it to the mounted components and closes over it in the
 * slot registrations; no module-level singleton).
 *
 * The store holds only browsing state: which root is shown, which view, and
 * a revision counter for list reloads. The request scope (session id + cwd)
 * is NOT stored — the mounting shell (the better-sidebar tab) supplies it as
 * a prop, so a session switch never leaves stale scope in the store.
 */

/** Which skill root the panel is showing. */
export type SkillsRoot = 'user' | 'project'

/** Panel view mode. */
export type SkillsView = 'list' | 'detail' | 'create'

/** One request scope (session id + optional cwd) the API calls ride. */
export interface SkillsScope {
  sessionId: string
  cwd?: string
}

/** The complete panel state (the store's snapshot shape). */
export interface SkillsPanelState {
  /** The root currently browsed. */
  root: SkillsRoot
  /** Current view mode. */
  view: SkillsView
  /** The skill name selected in detail view (empty in list/create). */
  selectedName: string
}

/** The store's write actions (components call these only). */
export interface SkillsPanelActions {
  switchRoot(root: SkillsRoot): void
  showList(): void
  showDetail(name: string): void
  showCreate(): void
}

/** The store product: immutable snapshot + subscribe + baked actions. */
export interface SkillsPanelStore {
  getSnapshot(): SkillsPanelState
  subscribe(fn: () => void): () => void
  actions: SkillsPanelActions
}

/** Factory: one store instance per plugin activation. */
export function createSkillsPanelStore(): SkillsPanelStore {
  let state: SkillsPanelState = {
    root: 'user',
    view: 'list',
    selectedName: '',
  }
  const listeners = new Set<() => void>()
  const emit = (): void => {
    for (const listener of listeners) listener()
  }
  const set = (patch: Partial<SkillsPanelState>): void => {
    state = { ...state, ...patch }
    emit()
  }
  const actions: SkillsPanelActions = {
    switchRoot(root) {
      set({ root, view: 'list', selectedName: '' })
    },
    showList() {
      set({ view: 'list', selectedName: '' })
    },
    showDetail(name) {
      set({ view: 'detail', selectedName: name })
    },
    showCreate() {
      set({ view: 'create', selectedName: '' })
    },
  }
  return {
    getSnapshot: () => state,
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    actions,
  }
}
