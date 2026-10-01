/**
 * Typed fetch wrapper over the /skills JSON API. Every call posts to
 * `/skills/api/<method>` with the sessionId and — when known — the session's
 * cwd from the client's own list summary. Failures surface as
 * {@link SkillsApiError} with the wire code.
 */
/** One wire failure. */
export declare class SkillsApiError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** One skill entry as the host lists it. */
export interface SkillsEntry {
    name: string;
    form: 'bundle' | 'flat';
    description: string;
    whenToUse?: string;
    path: string;
}
/** The full skill file as the host reads it. */
export interface SkillsFile extends SkillsEntry {
    raw: string;
    body: string;
}
/** Root info for the panel header. */
export interface SkillsRootsInfo {
    userRoot: string;
    projectRoot: string;
    cwd: string;
}
/** A root the get/update methods accept (levels + the library canonical). */
export type SkillsLevelRoot = 'user' | 'project' | 'library';
/** An assignment target: the user level or an indexed project root. */
export type SkillsAssignTarget = 'user' | {
    project: string;
};
/** One library skill: canonical metadata plus its assignment badges. */
export interface SkillsLibraryEntry {
    name: string;
    form: 'bundle' | 'flat';
    description: string;
    whenToUse?: string;
    /** 'user' and/or 'project:<root>' — every location holding a copy. */
    assignments: Array<'user' | `project:${string}`>;
}
/** One indexed project the library knows about. */
export interface SkillsProjectRef {
    root: string;
    label: string;
}
/** The library list payload. */
export interface SkillsLibraryData {
    skills: SkillsLibraryEntry[];
    projects: SkillsProjectRef[];
    /** The current session's project root (for the 「当前项目」 quick target). */
    currentProject: string;
}
/** One request's session scope: the conversation id plus its cwd when known. */
export interface SkillsSessionScope {
    sessionId: string;
    /** The session's working directory from the client list summary (optional). */
    cwd?: string;
}
/** The skills API surface (session scope threaded through every call). */
export declare const api: {
    rootsInfo: (scope: SkillsSessionScope, signal?: AbortSignal) => Promise<SkillsRootsInfo>;
    /** List one level root (user or project). */
    list: (scope: SkillsSessionScope, root: "user" | "project", signal?: AbortSignal) => Promise<SkillsEntry[]>;
    /** Read one skill from a level root or the library canonical. */
    get: (scope: SkillsSessionScope, root: SkillsLevelRoot, name: string, signal?: AbortSignal) => Promise<SkillsFile>;
    /** Replace the content of a skill (level copy or library canonical). */
    update: (scope: SkillsSessionScope, root: SkillsLevelRoot, name: string, content: string) => Promise<{
        ok: true;
    }>;
    /** Delete a skill everywhere (library canonical + all level copies). */
    delete: (scope: SkillsSessionScope, name: string) => Promise<{
        ok: true;
    }>;
    /** Rename a skill everywhere (library canonical + all level copies). */
    rename: (scope: SkillsSessionScope, name: string, newName: string) => Promise<{
        name: string;
    }>;
    /** Recycle a skill from one level (remove that copy only). */
    recycle: (scope: SkillsSessionScope, root: "user" | "project", name: string) => Promise<{
        ok: true;
    }>;
    /** List the library (canonical skills + assignments + indexed projects). */
    libraryList: (scope: SkillsSessionScope, signal?: AbortSignal) => Promise<SkillsLibraryData>;
    /** 移至 a library skill to the user/global level or the current project
     *  (copy the canonical; an existing copy is overwritten). */
    libraryAssign: (scope: SkillsSessionScope, name: string, to: SkillsAssignTarget) => Promise<{
        name: string;
        path: string;
    }>;
    /** Open the selected level's folder in the OS file manager. */
    openFolder: (scope: SkillsSessionScope, root: SkillsLevelRoot) => Promise<{
        ok: true;
        path: string;
    }>;
};
