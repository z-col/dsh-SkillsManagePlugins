/**
 * Client half of dsh-skills-manager: registers the Skills tab in the
 * dsh-better-sidebar sidebar (the plugin's only entry point). All copy rides
 * the DSH locale system; the manager store is one instance per activation.
 */
import type { Context } from '../context-types.ts'
import { createSkillsPanelStore } from './state.ts'
import { skillsTabDescriptor } from './SkillsTab.tsx'
import { LOCALE_NS, attachLocale, zh, en } from './locales.ts'

/** Services required before mounting (provided by the client runtime). */
export const inject = ['locale']

/**
 * Client plugin body.
 * @param ctx - the client cordis context (locale).
 */
export function apply(ctx: Context): void {
  attachLocale(ctx.locale)
  ctx.effect(() => {
    const offZh = ctx.locale.register(LOCALE_NS, 'zh', zh)
    const offEn = ctx.locale.register(LOCALE_NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'dsh-skills-manager: dictionaries')

  // The dsh-better-sidebar tab: registered when the sidebar plugin is
  // installed (ctx.inject waits for the service; its absence is silent).
  ctx.inject(['betterSidebar'], (sidebarCtx) => {
    const tabStore = createSkillsPanelStore()
    const disposer = sidebarCtx.betterSidebar?.registerTab(skillsTabDescriptor(tabStore))
    return () => { disposer?.() }
  })
}
