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
import type { Context } from '../context-types.ts'
import { createSkillsPanelStore } from './state.ts'
import { SkillsView } from './SkillsView.tsx'
import { LOCALE_NS, attachLocale, zh, en, t } from './locales.ts'

/** Services required before mounting (provided by the client runtime). */
export const inject = ['slots', 'locale', 'sessions']

/** The view tab id: unique among the session's views (chat, trajectory, …). */
export const SKILLS_VIEW_ID = 'skills'

/** Row order in the view tab strip: chat 0, trajectory 10, skills 20. */
const SKILLS_VIEW_ORDER = 20

/**
 * Client plugin body.
 * @param ctx - the client cordis context (slots / locale / sessions).
 */
export function apply(ctx: Context): void {
  attachLocale(ctx.locale)
  ctx.effect(() => {
    const offZh = ctx.locale.register(LOCALE_NS, 'zh', zh)
    const offEn = ctx.locale.register(LOCALE_NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'dsh-skills-manager: dictionaries')

  const store = createSkillsPanelStore()

  // The view tab. `conversation.view` is declared by ui-conversation's
  // `conversation.session` entry; inject waits for that declaration and
  // unloads with this fiber. The label rides our own locale-aware `t()`, and
  // ui-conversation re-reads tab labels on every locale switch, so the
  // function form stays current.
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    {
      name: 'conversation.view',
      id: SKILLS_VIEW_ID,
      order: SKILLS_VIEW_ORDER,
      label: () => t('panelTitle'),
      // Session-scoped seat: the factory's first argument is the SessionId this
      // instance renders for; hand it (with the plugin's own context + store)
      // to the view as its props.
      inject: (sessionId: string) => ({ ctx, store, sessionId }),
    },
    SkillsView,
  ))
}
