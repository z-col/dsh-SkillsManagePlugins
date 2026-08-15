/**
 * The standalone Skills manager entry, used while dsh-better-sidebar is NOT
 * installed: a utility button in the conversation session header
 * (`conversation.session.header.utilities`) toggles a floating panel
 * (`shell.overlay`) hosting the same manager body as the sidebar tab. The
 * panel reads the request scope (current session id + cwd) from the client
 * sessions list feed, exactly like the sidebar shell does.
 *
 * All registrations go through `ctx.slots.inject`, so they wait for the
 * owner's slot declaration (the conversation header and the app frame are
 * both part of the base app bundles) and are collected on unload.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { IconSkillOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../context-types.ts'
import type { SkillsPanelStore, SkillsScope, SkillsStandaloneStore } from './state.ts'
import { createSkillsPanelStore, createSkillsStandaloneStore } from './state.ts'
import { SkillsManagerBody } from './SkillsPanel.tsx'
import { t } from './locales.ts'
import css from './SkillsPanel.module.css'

/** The header utility button: toggles the floating skills panel. */
function SkillsHeaderButton(props: { store: SkillsStandaloneStore }) {
  const { store } = props
  const open = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().open,
  )
  return (
    <button
      type="button"
      className={`${css.standaloneToggle} ${open ? css.standaloneToggleActive : ''}`}
      aria-label={t('panelTitle')}
      title={t('panelTitle')}
      onClick={() => store.actions.toggle()}
    >
      <IconSkillOutline16 />
    </button>
  )
}

/** The floating panel: the manager body docked to the right viewport edge. */
function SkillsOverlay(props: {
  store: SkillsStandaloneStore
  panelStore: SkillsPanelStore
  ctx: Context
}) {
  const { store, panelStore, ctx } = props
  const open = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().open,
  )
  const sessionList = useSyncExternalStore(
    ctx.sessions.list.subscribe,
    () => ctx.sessions.list.getSnapshot(),
  )

  // Escape closes the panel while it is open.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') store.actions.close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, store])

  if (!open) return null
  const sessionId = sessionList.current
  const summary = sessionId === undefined ? undefined : sessionList.byId[sessionId]
  const scope: SkillsScope = { sessionId: sessionId ?? '', cwd: summary?.cwd }
  return (
    <div className={css.overlayRoot}>
      <div className={css.overlayHeader}>
        <span className={css.overlayTitle}>{t('panelTitle')}</span>
        <button
          type="button"
          className={css.overlayClose}
          aria-label={t('close')}
          onClick={() => store.actions.close()}
        >
          ×
        </button>
      </div>
      <div className={css.overlayBody}>
        {sessionId === undefined ? (
          <p className={css.status}>{t('noSession')}</p>
        ) : (
          <SkillsManagerBody store={panelStore} scope={scope} />
        )}
      </div>
    </div>
  )
}

/**
 * Register the standalone surfaces (header button + floating panel) and
 * return the disposer. Each surface waits for its owner's slot declaration
 * via `ctx.slots.inject`; the returned disposer tears both down.
 */
export function registerStandalone(ctx: Context): () => void {
  const store = createSkillsStandaloneStore()
  const panelStore = createSkillsPanelStore()
  const disposers: Array<() => void> = []

  // The header utility button: registered once the conversation session
  // header declares the slot.
  disposers.push(ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register(
      { name: 'conversation.session.header.utilities', id: 'skills-manager', order: 40, label: () => t('panelTitle') },
      () => <SkillsHeaderButton store={store} />,
    ),
  ))

  // The floating panel: registered once the app frame declares the overlay
  // slot. Renders nothing while closed (click-through); opts into pointer
  // events only when open.
  disposers.push(ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'skills-manager', order: 40 },
      () => <SkillsOverlay store={store} panelStore={panelStore} ctx={ctx} />,
    ),
  ))

  return () => {
    for (const disposer of disposers.reverse()) disposer?.()
  }
}
