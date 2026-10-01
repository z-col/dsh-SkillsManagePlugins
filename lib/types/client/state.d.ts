/**
 * Skills manager panel state: a tiny per-activation store (the official
 * createXXXStore() factory rule — production code creates it only inside
 * apply(), then hands it to the mounted components and closes over it in the
 * slot registrations; no module-level singleton).
 *
 * The store holds only browsing state: which root is shown, which view, and
 * a revision counter for list reloads. The request scope (session id + cwd) is
 * NOT stored — the conversation-view tab ({@link SkillsView}) receives its
 * SessionId from the session-scoped slot injection, so a session switch never
 * leaves stale scope in the store.
 */
/** Which surface the panel is showing: a level root or the skill library. */
export type SkillsRoot = 'user' | 'project' | 'library';
/** Panel view mode (the skill list vs one skill's detail). */
export type SkillsViewMode = 'list' | 'detail';
/** One request scope (session id + optional cwd) the API calls ride. */
export interface SkillsScope {
    sessionId: string;
    cwd?: string;
}
/** The complete panel state (the store's snapshot shape). */
export interface SkillsPanelState {
    /** The root currently browsed. */
    root: SkillsRoot;
    /** Current view mode. */
    view: SkillsViewMode;
    /** The skill name selected in detail view (empty in list/create). */
    selectedName: string;
}
/** The store's write actions (components call these only). */
export interface SkillsPanelActions {
    switchRoot(root: SkillsRoot): void;
    showList(): void;
    showDetail(name: string): void;
}
/** The store product: immutable snapshot + subscribe + baked actions. */
export interface SkillsPanelStore {
    getSnapshot(): SkillsPanelState;
    subscribe(fn: () => void): () => void;
    actions: SkillsPanelActions;
}
/** Factory: one store instance per plugin activation. */
export declare function createSkillsPanelStore(): SkillsPanelStore;
