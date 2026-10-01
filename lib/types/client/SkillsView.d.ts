/**
 * The Skills manager as a conversation view tab — the same seat 对话 (chat) and
 * 轨迹 (trajectory) occupy: the tab strip in the session header selects it and
 * the centre column renders the manager body in place of the transcript.
 *
 * The seat is SESSION-scoped, so its `inject` factory hands this component the
 * session it belongs to; the request scope is never guessed from a global
 * "current session" field. (DSH ≤0.1.x carried one at
 * `ctx.sessions.list.getSnapshot().current`; 0.2 removed it, so a panel that
 * reads it renders 「暂无会话」 on every 0.2 client.)
 */
import { type ReactNode } from 'react';
import type { Context } from '../context-types.ts';
import type { SkillsPanelStore } from './state.ts';
/** The props the slot's injection supplies on top of the framework kit. */
export interface SkillsViewProps {
    /** The client context (sessions feed + locale). */
    ctx: Context;
    /** The per-activation manager store (view state survives view switches). */
    store: SkillsPanelStore;
    /** The session this view instance belongs to (from the slot injection). */
    sessionId: string;
}
/**
 * One session's Skills manager view.
 * @param props - the injected context, manager store, and owning session.
 * @returns the manager body sized to the conversation's view area.
 */
export declare function SkillsView(props: SkillsViewProps): ReactNode;
