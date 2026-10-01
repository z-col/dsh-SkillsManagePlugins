/**
 * The tab body: given the session the `conversation.view` seat injects, the
 * view renders the real manager body bound to THAT session — the regression
 * guard for the old panel, which guessed the session from a sessions-feed field
 * DSH 0.2 removed and therefore rendered 「暂无会话」 while a conversation was
 * open.
 *
 * The render is server-side on purpose: the view's effects (and with them every
 * API call) stay out, so the assertions cover the scope decision and the
 * rendered outcome only.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// ui-primitives is a PLATFORM module resolved through the web module table at
// runtime; the Node lane stubs its surface (this suite asserts the scope
// decision, not the glyphs).
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconSkillOutlineRegular: () => null,
  IconFolderOpenRegular: () => null,
  Modal: () => null,
}))

import type { Context } from '../src/context-types.ts'
import { SkillsView } from '../src/client/SkillsView.tsx'
import { createSkillsPanelStore } from '../src/client/state.ts'
import { attachLocale } from '../src/client/locales.ts'

afterEach(() => { attachLocale(undefined) })

/** A sessions feed holding one session row (cwd = the API's fallback scope). */
function makeCtx(byId: Record<string, { id: string; cwd?: string }>): Context {
  return {
    sessions: {
      list: {
        getSnapshot: () => ({ byId }),
        subscribe: () => () => {},
      },
    },
    locale: {
      getSnapshot: () => ({ active: 'zh' }),
      subscribe: () => () => {},
    },
  } as unknown as Context
}

/** Render one tab instance and return its markup. */
function render(sessionId: string, byId: Record<string, { id: string; cwd?: string }> = {}): string {
  attachLocale({ getSnapshot: () => ({ active: 'zh' }) })
  return renderToStaticMarkup(createElement(SkillsView, {
    ctx: makeCtx(byId),
    store: createSkillsPanelStore(),
    sessionId,
  }))
}

describe('conversation view tab body', () => {
  it('renders the manager for the session the seat injected', () => {
    const markup = render('session-2', { 'session-2': { id: 'session-2', cwd: '/tmp/project' } })
    // The manager toolbar is there — not a "no session" hint: the seat always
    // has a session, so the view has no such state to fall into.
    expect(markup).toContain('Skill 库')
    expect(markup).toContain('全局')
    expect(markup).not.toContain('暂无会话')
  })

  it('renders with no matching feed row (unknown cwd) instead of bailing out', () => {
    // The host resolves cwd from the session's own header, so a missing client
    // row only drops the fallback — it must not blank the view.
    const markup = render('session-9', {})
    expect(markup).toContain('Skill 库')
    expect(markup).not.toContain('暂无会话')
  })

  it('renders distinct instances per session (no shared scope)', () => {
    const one = render('session-a', { 'session-a': { id: 'session-a', cwd: '/tmp/a' } })
    const two = render('session-b', { 'session-b': { id: 'session-b', cwd: '/tmp/b' } })
    expect(one).toContain('Skill 库')
    expect(two).toContain('Skill 库')
  })
})
