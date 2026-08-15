/**
 * Real-composition client wiring test: boots a genuine cordis Context,
 * provides stub client services (locale / slots / sessions), mounts the
 * client plugin, and drives the betterSidebar service's presence to verify
 * the three entry scenarios:
 *
 * 1. Sidebar installed → the Skills tab is registered.
 * 2. Sidebar absent → the standalone surfaces (header utility + overlay)
 *    are registered instead.
 * 3. Sidebar installed AFTER us → the tab appears and the standalone entry
 *    is torn down; removing the sidebar brings the standalone entry back.
 *
 * No React rendering happens here — the wiring (which surfaces are mounted
 * and when) is the part under test.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject } from '../src/client/index.tsx'

/** Let cordis fibers settle (inject callbacks, notify refreshes). */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

interface Hooks {
  /** The keys passed to `slots.inject` (deduped, in order). */
  injectedKeys: string[]
  /** shell.overlay registration / disposal counts (the standalone panel). */
  overlayRegisters: number
  overlayDisposes: number
  /** The tab descriptors handed to `registerTab`. */
  tabDescriptors: unknown[]
}

function makeSlotsStub(hooks: Hooks) {
  return {
    register(options: { name: string }, _component: unknown): () => void {
      if (options.name === 'shell.overlay') hooks.overlayRegisters += 1
      return () => {
        if (options.name === 'shell.overlay') hooks.overlayDisposes += 1
      }
    },
    inject(key: string, callback: () => () => void): () => void {
      if (!hooks.injectedKeys.includes(key)) hooks.injectedKeys.push(key)
      const dispose = callback()
      return () => { dispose?.() }
    },
  }
}

describe('client entry wiring (three scenarios)', () => {
  it('standalone ↔ tab swap follows the betterSidebar service', async () => {
    const hooks: Hooks = { injectedKeys: [], overlayRegisters: 0, overlayDisposes: 0, tabDescriptors: [] }
    const app = new Context()
    app.provide('locale', {
      register: () => () => {},
      getSnapshot: () => ({ active: 'zh' }),
      subscribe: () => () => {},
    })
    app.provide('sessions', {
      list: { getSnapshot: () => ({ current: undefined, byId: {} }), subscribe: () => () => {} },
    })
    app.provide('slots', makeSlotsStub(hooks))

    const pluginObject: unknown = { inject, apply }
    const pluginFiber = app.plugin(pluginObject as Parameters<typeof app.plugin>[0], {})
    await pluginFiber

    // Scenario 2: no sidebar → the standalone surfaces are registered.
    expect(hooks.injectedKeys).toContain('conversation.session.header.utilities')
    expect(hooks.injectedKeys).toContain('shell.overlay')
    expect(hooks.overlayRegisters).toBe(1)
    expect(hooks.tabDescriptors).toHaveLength(0)

    // Scenario 3a: the sidebar is installed AFTER us → the tab appears and
    // the standalone entry is torn down (the two never coexist).
    const sidebar = {
      registerTab: (descriptor: unknown): (() => void) => {
        hooks.tabDescriptors.push(descriptor)
        return () => {}
      },
    }
    const unprovideSidebar = app.provide('betterSidebar', sidebar)
    await tick()
    await tick()
    expect(hooks.tabDescriptors).toHaveLength(1)
    expect(hooks.overlayDisposes).toBe(1)

    // Scenario 3b: the sidebar is removed → the standalone entry returns.
    unprovideSidebar()
    await tick()
    await tick()
    expect(hooks.overlayRegisters).toBe(2)
    expect(hooks.tabDescriptors).toHaveLength(1)

    await pluginFiber.dispose()
  })

  it('does not register the standalone entry when the sidebar is already present', async () => {
    const hooks: Hooks = { injectedKeys: [], overlayRegisters: 0, overlayDisposes: 0, tabDescriptors: [] }
    const app = new Context()
    app.provide('locale', {
      register: () => () => {},
      getSnapshot: () => ({ active: 'zh' }),
      subscribe: () => () => {},
    })
    app.provide('sessions', {
      list: { getSnapshot: () => ({ current: undefined, byId: {} }), subscribe: () => () => {} },
    })
    app.provide('slots', makeSlotsStub(hooks))
    app.provide('betterSidebar', {
      registerTab: (descriptor: unknown): (() => void) => {
        hooks.tabDescriptors.push(descriptor)
        return () => {}
      },
    })

    const pluginObject: unknown = { inject, apply }
    const pluginFiber = app.plugin(pluginObject as Parameters<typeof app.plugin>[0], {})
    await pluginFiber
    await tick()
    await tick()

    expect(hooks.tabDescriptors).toHaveLength(1)
    expect(hooks.overlayRegisters).toBe(0)
    expect(hooks.injectedKeys).not.toContain('shell.overlay')

    await pluginFiber.dispose()
  })
})
