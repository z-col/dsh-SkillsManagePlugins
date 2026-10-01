import type { Context } from './context-types.ts';
/** Plugin identity for cordis.yml rows. */
export declare const name = "dsh-skills-manager";
/** Services required before mounting: the webserver routes, the session store, and the loader's connection row. */
export declare const inject: string[];
/**
 * Plugin body: mount the fenced /skills API routes.
 * @param ctx - the host cordis context.
 */
export declare function apply(ctx: Context): void;
export { isTrustedApiRequest, isLoopbackHostname } from './trust-fence.ts';
export type { SkillsErrorCode } from './wire.ts';
export { SkillsError } from './wire.ts';
export type { SkillEntry, SkillRootKind, SkillFileContent, SkillCreateInput } from './skill-fs.ts';
export { librarySkillsRoot, readProjectIndex, recordProjectRoot, reconcileLibrary, copySkillEntryToRoot, recycleSkillFromRoot, syncSkillEntry, deleteSkillEverywhere, renameSkillEverywhere, skillExistsInRoot, } from './skill-fs.ts';
