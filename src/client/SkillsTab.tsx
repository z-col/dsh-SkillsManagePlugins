/**
 * The dsh-better-sidebar tab shell for the Skills manager. Registered
 * through the optional `ctx.betterSidebar` service: when the sidebar plugin
 * is installed, its + menu offers a Skills tab that renders the same
 * {@link SkillsManagerBody} as the overlay panel, with the request scope
 * supplied by the sidebar (the current session's id + cwd).
 */
import { createElement, useEffect, useState } from 'react'
import { IconSkillOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillsPanelStore, SkillsScope } from './state.ts'
import { SkillsManagerBody } from './SkillsPanel.tsx'
import { t } from './locales.ts'
import css from './SkillsPanel.module.css'

/** The props dsh-better-sidebar passes to a registered tab component. */
export interface SkillsTabProps {
  /** The client cordis context (unused by this tab; the body uses its scope). */
  ctx: unknown
  /** The sidebar's store (unused here). */
  store: unknown
  /** The current session scope: conversation id plus its cwd when known. */
  scope: SkillsScope
  /** The open tab record. */
  tab: { id: string; type: string; title: string; path?: string }
  /** Whether this tab is the active one AND the panel is open. */
  visible: boolean
}

/** Per-tab store factory (one manager store per mounted tab). */
export interface SkillsTabInjected {
  /** The manager store this tab instance owns. */
  managerStore: SkillsPanelStore
}

/** The tab content: the shared manager body inside the sidebar pane. */
export function SkillsTab(props: SkillsTabProps & SkillsTabInjected) {
  const { managerStore, visible } = props
  const [, force] = useState(0)
  useEffect(() => managerStore.subscribe(() => force(v => v + 1)), [managerStore])
  if (!visible) return null
  return (
    <div className={css.tabRoot}>
      <SkillsManagerBody store={managerStore} scope={props.scope} />
    </div>
  )
}

/** The tab descriptor (structural mirror; passed to ctx.betterSidebar). */
export function skillsTabDescriptor(managerStore: SkillsPanelStore): {
  id: string
  title: string | (() => string)
  icon: unknown
  order: number
  single: boolean
  component: (props: SkillsTabProps) => unknown
} {
  return {
    id: 'skills-manager',
    title: () => t('panelTitle'),
    icon: (size: number) => createElement(IconSkillOutline16, { size }),
    order: 30,
    single: true,
    component: (props: SkillsTabProps) => (
      <SkillsTab {...props} managerStore={managerStore} />
    ),
  }
}
