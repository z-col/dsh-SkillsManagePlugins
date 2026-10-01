/**
 * Real-composition client wiring test: boots a genuine cordis Context,
 * provides stub client services (locale / slots / sessions), mounts the
 * client plugin, and verifies the conversation-view wiring:
 *
 * 1. the manager registers into ui-conversation's `conversation.view` list
 *    seat, under an id of its own, ordered after 对话 (chat, 0) and
 *    轨迹 (trajectory, 10), with a locale-following label;
 * 2. the registration carries a session-scoped `inject` factory that supplies
 *    the owning SessionId — the scope rides the seat, never a global
 *    "current session" field (the DSH 0.2 removal that broke the old panel);
 * 3. no other surface is registered (no sidebar row / layout main page / old
 *    standalone overlay), whatever the `betterSidebar` service does;
 * 4. plugin-fiber disposal releases the locale dictionaries.
 *
 * No React rendering happens here — the wiring (which surfaces are mounted
 * and with which options) is the part under test; the rendered outcome is
 * covered by client-view.spec.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

// ui-primitives is a PLATFORM module: the web module table supplies it at
// runtime, and the client bundle never ships it. The Node test lane has no
// such table (and the package's own runtime deps are not installed here), so
// its surface is stubbed — this suite asserts wiring, not glyphs.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconSkillOutlineRegular: () => null,
  IconFolderOpenRegular: () => null,
  Modal: () => null,
}))

import { apply, inject, SKILLS_VIEW_ID } from '../src/client/index.tsx'

/** Let cordis fibers settle (inject callbacks, notify refreshes). */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

interface Hooks {
  /** The keys passed to `slots.inject` (deduped, in order). */
  injectedKeys: string[]
  /** Every `slots.register` call's options. */
  registers: Array<Record<string, unknown>>
  /** Locale dictionary registrations: [namespace, language] → disposer calls. */
  localeRegisters: number
  localeDisposals: number
  /** Calls into the (irrelevant) betterSidebar service. */
  betterSidebarCalls: number
}

function makeSlotsStub(hooks: Hooks) {
  return {
    register(options: Record<string, unknown>, _component: unknown): () => void {
      hooks.registers.push(options)
      return () => {}
    },
    inject(key: string, callback: () => () => void): () => void {
      if (!hooks.injectedKeys.includes(key)) hooks.injectedKeys.push(key)
      const dispose = callback()
      return () => { dispose?.() }
    },
  }
}

function makeLocaleStub(hooks: Hooks, active: { value: string }) {
  return {
    getSnapshot: () => ({ active: active.value }),
    subscribe: () => () => {},
    register: () => {
      hooks.localeRegisters += 1
      return () => { hooks.localeDisposals += 1 }
    },
  }
}

function makeHooks(): Hooks {
  return {
    injectedKeys: [], registers: [], localeRegisters: 0, localeDisposals: 0, betterSidebarCalls: 0,
  }
}

/** Mount the client plugin over stub services. */
async function mount(
  hooks: Hooks,
  active: { value: string },
  extra: Record<string, unknown> = {},
): Promise<{ pluginFiber: { dispose(): Promise<void> } }> {
  const app = new Context()
  app.provide('locale', makeLocaleStub(hooks, active))
  app.provide('sessions', {
    list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} },
  })
  app.provide('slots', makeSlotsStub(hooks))
  for (const [name, value] of Object.entries(extra)) app.provide(name, value)
  const pluginObject: unknown = { inject, apply }
  const pluginFiber = app.plugin(pluginObject as Parameters<typeof app.plugin>[0], {})
  await pluginFiber
  return { pluginFiber }
}

describe('client entry wiring (conversation view tab)', () => {
  it('registers one tab into `conversation.view` with a unique id, order, and label', async () => {
    const hooks = makeHooks()
    const { pluginFiber } = await mount(hooks, { value: 'zh' })

    // The owner's declaration is waited for, then the single tab registers.
    expect(hooks.injectedKeys).toContain('conversation.view')
    expect(hooks.registers).toHaveLength(1)

    const tab = hooks.registers[0]
    expect(tab?.name).toBe('conversation.view')
    // A fresh id: the shipped views are `chat` (0) and `trajectory` (10).
    expect(tab?.id).toBe(SKILLS_VIEW_ID)
    expect(tab?.id).not.toBe('chat')
    expect(tab?.id).not.toBe('trajectory')
    expect(tab?.order).toBe(20)
    expect(typeof tab?.label).toBe('function')
    expect((tab?.label as () => string)()).toBe('Skills 管理器')

    await pluginFiber.dispose()
  })

  it('injects the owning SessionId into the tab (the request scope rides the seat)', async () => {
    const hooks = makeHooks()
    const { pluginFiber } = await mount(hooks, { value: 'zh' })
    const tab = hooks.registers[0]
    const injected = (tab?.inject as (sessionId: string) => Record<string, unknown>)('session-42')

    // The factory hands the view exactly the session it renders for.
    expect(injected.sessionId).toBe('session-42')
    // …plus the plugin's own activation context and browsing store.
    expect(injected.ctx).toBeDefined()
    expect(injected.store).toBeDefined()

    await pluginFiber.dispose()
  })

  it('follows locale switches in the tab label without re-registering', async () => {
    const hooks = makeHooks()
    const active = { value: 'zh' }
    const { pluginFiber } = await mount(hooks, active)
    const tab = hooks.registers[0]
    expect((tab?.label as () => string)()).toBe('Skills 管理器')

    active.value = 'en'
    expect((tab?.label as () => string)()).toBe('Skills Manager')

    await pluginFiber.dispose()
  })

  it('registers nothing else: no sidebar row, no layout page, no overlay', async () => {
    const hooks = makeHooks()
    // The old service may still exist (the user's own sidebar plugin) — it
    // must be ignored entirely.
    const { pluginFiber } = await mount(hooks, { value: 'zh' }, {
      betterSidebar: {
        registerTab: () => {
          hooks.betterSidebarCalls += 1
          return () => {}
        },
      },
    })
    await tick()

    expect(hooks.betterSidebarCalls).toBe(0)
    expect(hooks.injectedKeys).toEqual(['conversation.view'])
    expect(hooks.registers.map((options) => options.name)).toEqual(['conversation.view'])

    await pluginFiber.dispose()
  })

  it('registers the locale dictionaries and releases them on fiber disposal', async () => {
    const hooks = makeHooks()
    const { pluginFiber } = await mount(hooks, { value: 'zh' })

    // zh + en under the plugin namespace.
    expect(hooks.localeRegisters).toBe(2)
    expect(hooks.localeDisposals).toBe(0)

    await pluginFiber.dispose()
    expect(hooks.localeDisposals).toBe(2)
  })
})
