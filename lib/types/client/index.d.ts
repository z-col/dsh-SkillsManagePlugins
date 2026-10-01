/**
 * Client half of dsh-skills-manager: one entry — a conversation view tab.
 *
 * The plugin contributes a third view to the session's view tab strip (对话 =
 * ui-chat's `chat`, 轨迹 = ui-trajectory's `trajectory`) by registering into
 * ui-conversation's `conversation.view` list seat; selecting the tab renders
 * the manager in the centre column, exactly like the shipped 轨迹 tab.
 *
 * The seat is SESSION-scoped: the registration's `inject` factory receives the
 * SessionId of the session the tab belongs to and is what the manager's request
 * scope rides, so no global "current session" field is read (DSH 0.2 removed
 * the one 0.1.x exposed, which is why a panel guessing it rendered 「暂无会话」
 * on every 0.2 client).
 *
 * Registration waits for ui-conversation's declaration through
 * `ctx.slots.inject`, so activation order never matters (ui-conversation may
 * activate before or after this plugin) and fiber disposal removes the tab with
 * no dangling entry.
 *
 * All copy rides the DSH locale system; the manager store is one instance per
 * activation (view state survives tab switches).
 */
import type { Context } from '../context-types.ts';
/** Services required before mounting (provided by the client runtime). */
export declare const inject: string[];
/** The view tab id: unique among the session's views (chat, trajectory, …). */
export declare const SKILLS_VIEW_ID = "skills";
/**
 * Client plugin body.
 * @param ctx - the client cordis context (slots / locale / sessions).
 */
export declare function apply(ctx: Context): void;
