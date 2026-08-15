/**
 * Client half of dsh-skills-manager: two mutually exclusive entry points.
 *
 * 1. Integrated — when dsh-better-sidebar is installed (now or later): the
 *    Skills tab in its + menu. `ctx.inject(['betterSidebar'])` is a cordis
 *    fiber that stays pending while the service is absent and fires when it
 *    is provided (the runtime re-evaluates pending injects on service
 *    provide/unload), so installing the sidebar AFTER this plugin just works.
 *
 * 2. Standalone — while dsh-better-sidebar is absent: a conversation-header
 *    utility button opens a floating panel (`shell.overlay`) hosting the same
 *    manager body. The surfaces are torn down the moment the sidebar appears
 *    (the tab takes over) and re-registered if it is later removed.
 *
 * All copy rides the DSH locale system; each manager store is one instance
 * per activation.
 */
import type { Context } from '../context-types.ts'
import { createSkillsPanelStore } from './state.ts'
import { skillsTabDescriptor } from './SkillsTab.tsx'
import { registerStandalone } from './StandaloneEntry.tsx'
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

  // ── Integrated entry: the dsh-better-sidebar tab. The fiber fires whenever
  // the sidebar service is provided (including install-after-us) and unloads
  // when it is removed; its absence is silent.
  ctx.inject(['betterSidebar'], (sidebarCtx) => {
    const tabStore = createSkillsPanelStore()
    const disposer = sidebarCtx.betterSidebar?.registerTab(skillsTabDescriptor(tabStore))
    return () => { disposer?.() }
  })

  // ── Standalone entry: active while the sidebar is ABSENT. The slots and
  // sessions services always exist in the web app; we gate on the sidebar's
  // presence and watch the `internal/service` event so the standalone
  // surfaces appear/disappear exactly when the sidebar disappears/appears
  // (the two entries are never mounted together).
  ctx.inject(['slots', 'sessions'], (standaloneCtx) => {
    if (standaloneCtx.get('betterSidebar') !== undefined) return
    let disposed = false
    let disposeStandalone: (() => void) | undefined = registerStandalone(standaloneCtx)
    const off = standaloneCtx.on('internal/service', (...args) => {
      if (disposed) return
      const name = args[0] as string | undefined
      if (name !== 'betterSidebar') return
      const value = args[1]
      if (value !== undefined) {
        // The sidebar arrived (installed after us): the tab fiber above has
        // already mounted — unmount the standalone entry.
        disposeStandalone?.()
        disposeStandalone = undefined
      } else if (disposeStandalone === undefined) {
        // The sidebar was removed: the tab fiber unloaded — bring the
        // standalone entry back.
        disposeStandalone = registerStandalone(standaloneCtx)
      }
    })
    return () => {
      disposed = true
      off()
      disposeStandalone?.()
    }
  })
}
