/** The skill root kinds the manager addresses. */
export type SkillRootKind = 'user' | 'project';
/** One skill entry discovered under a root. */
export interface SkillEntry {
    /** Kebab-case skill name (the directory or file base name). */
    name: string;
    /** The SKILL.md (bundle) or <name>.md (flat) absolute path. */
    path: string;
    /** The skill body directory (bundle: <name>/; flat: the root). */
    directory: string;
    /** Bundle skills own a directory with SKILL.md; flat skills are one .md file. */
    form: 'bundle' | 'flat';
    /** Frontmatter description. */
    description: string;
    /** Optional frontmatter whenToUse. */
    whenToUse?: string;
}
/** A full skill file read: raw text plus parsed frontmatter fields. */
export interface SkillFileContent {
    name: string;
    description: string;
    whenToUse?: string;
    /** The raw SKILL.md text (frontmatter + body). */
    raw: string;
    /** The markdown body after the closing frontmatter fence. */
    body: string;
}
/** Frontmatter fields accepted when creating a skill. */
export interface SkillCreateInput {
    name: string;
    description: string;
    whenToUse?: string;
    body?: string;
}
/** Resolve the user skill root: <$DSH_HOME>/skills. */
export declare function userSkillsRoot(): string;
/**
 * Find the project root for a cwd: walk up to the nearest ancestor holding a
 * `.git` entry; when none exists, the cwd itself is the project root (the
 * same rule as @deepseek-ai/dsh-skill-filesystem's findProjectRoot).
 */
export declare function findProjectRoot(cwd: string): Promise<string>;
/** Resolve the project skill root: <projectRoot>/.dsh/skills. */
export declare function projectSkillsRoot(projectRoot: string): string;
/** Assert that `candidate` resolves inside `root` (realpath-canonical on the root). */
export declare function assertWithinRoot(root: string, candidate: string): string;
/** Assert a skill name follows the public kebab-case grammar. */
export declare function assertSkillName(name: string): string;
/** Resolve the absolute SKILL.md path for a bundle skill under a root. */
export declare function bundleSkillPath(root: string, name: string): string;
/** Resolve the absolute path for a flat skill file under a root. */
export declare function flatSkillPath(root: string, name: string): string;
/**
 * Scan one skill root for skill entries. Missing or unreadable roots return
 * an empty list; the official provider treats them the same way.
 */
export declare function scanSkillsRoot(root: string): Promise<SkillEntry[]>;
/**
 * Read and parse one skill file (SKILL.md or <name>.md). The official
 * provider requires frontmatter with `name` and `description`; a file
 * without them is not a valid skill. Returns the parsed content or throws
 * SkillsError not-found when the file is missing or malformed.
 */
export declare function readSkillFile(path: string): Promise<SkillFileContent>;
/** Serialize a skill file body with a complete frontmatter block. */
export declare function serializeSkillFile(input: SkillCreateInput): string;
/** Create a bundle skill (directory + SKILL.md) with no-clobber semantics. */
export declare function createBundleSkill(root: string, input: SkillCreateInput): Promise<SkillEntry>;
/** Replace the full content of a skill file atomically. */
export declare function updateSkillFile(path: string, raw: string): Promise<void>;
/** Delete a skill entry: the bundle directory (recursive) or the flat file. */
export declare function deleteSkillEntry(entry: Pick<SkillEntry, 'directory' | 'form' | 'path'>): Promise<void>;
/** Rename a skill entry to a new kebab-case name (no-clobber on the target).
 *  The frontmatter `name` field is rewritten to match, because the runtime
 *  catalog derives the skill name from frontmatter, not from the directory. */
export declare function renameSkillEntry(entry: Pick<SkillEntry, 'directory' | 'form' | 'name' | 'description' | 'path'>, root: string, newName: string): Promise<SkillEntry>;
/** The canonical skill-library root: <$DSH_HOME>/skill-library. */
export declare function librarySkillsRoot(): string;
/** The skills-manager state index: <$DSH_HOME>/skills-manager/index.json. */
export declare function skillsIndexPath(): string;
/** Read the recorded project roots from the index (missing/corrupt → []). */
export declare function readProjectIndex(): Promise<string[]>;
/** Record a project root into the index (idempotent; atomic write). */
export declare function recordProjectRoot(root: string): Promise<void>;
/** Whether a skill name exists in a root (bundle directory or flat file). */
export declare function skillExistsInRoot(root: string, name: string): Promise<boolean>;
/** Remove a skill name from a root (bundle directory or flat file). Throws
 *  not-found when neither form is present. */
export declare function removeSkillNameFromRoot(root: string, name: string): Promise<void>;
/** Copy a skill entry into a destination root, preserving its form. With
 *  `overwrite` an existing copy is replaced (the stale opposite form is
 *  removed first); otherwise the target must be free (no-clobber → conflict).
 *  The destination root chain is created on demand. */
export declare function copySkillEntryToRoot(entry: Pick<SkillEntry, 'name' | 'form' | 'directory' | 'path' | 'description'>, destRoot: string, options?: {
    overwrite?: boolean;
}): Promise<SkillEntry>;
/** Reconcile the library with the user root and every recorded project root:
 *  skills present in those roots but missing from the library are copied in
 *  (canonicalized as bundle form). Idempotent; missing roots are skipped. */
export declare function reconcileLibrary(projectRoots: string[]): Promise<void>;
/** The assignment targets of a canonical skill: 'user' and/or 'project:<root>'
 *  for every root where a copy currently exists. */
export declare function assignmentTargetsOf(entry: Pick<SkillEntry, 'name'>, projectRoots: string[]): Promise<Array<'user' | `project:${string}`>>;
/** Push the canonical library copy to every root where the skill is assigned
 *  (overwrite). Returns the refreshed targets. */
export declare function syncSkillEntry(entry: SkillEntry, projectRoots: string[]): Promise<Array<'user' | `project:${string}`>>;
/** Recycle a skill from one level root (user or project): remove the copy,
 *  keep the library canonical. */
export declare function recycleSkillFromRoot(name: string, destRoot: string): Promise<void>;
/** Delete a skill everywhere: the library canonical, the user root, and every
 *  recorded project root. Throws not-found when the skill is nowhere. */
export declare function deleteSkillEverywhere(name: string, projectRoots: string[]): Promise<void>;
/** Rename a skill in a single root (bundle directory or flat file), rewriting
 *  the frontmatter name (no-clobber on the target in this root). */
export declare function renameSkillInRoot(root: string, name: string, newName: string): Promise<void>;
/** Rename a skill everywhere: the library canonical, the user root, and every
 *  recorded project root. The new name must be free in ALL locations
 *  (no-clobber); at least one location must hold the old name. */
export declare function renameSkillEverywhere(name: string, newName: string, projectRoots: string[]): Promise<void>;
