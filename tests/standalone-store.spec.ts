/**
 * Tests for the standalone overlay store (the floating-panel open/close state
 * used while dsh-better-sidebar is absent).
 */
import { describe, expect, it } from 'vitest'
import { createSkillsStandaloneStore } from '../src/client/state.ts'

describe('createSkillsStandaloneStore', () => {
  it('starts closed', () => {
    const store = createSkillsStandaloneStore()
    expect(store.getSnapshot()).toEqual({ open: false })
  })

  it('toggles and closes, notifying subscribers', () => {
    const store = createSkillsStandaloneStore()
    const seen: boolean[] = []
    const off = store.subscribe(() => seen.push(store.getSnapshot().open))

    store.actions.toggle()
    expect(store.getSnapshot().open).toBe(true)
    store.actions.toggle()
    expect(store.getSnapshot().open).toBe(false)
    store.actions.toggle()
    expect(store.getSnapshot().open).toBe(true)
    store.actions.close()
    expect(store.getSnapshot().open).toBe(false)
    expect(seen).toEqual([true, false, true, false])

    off()
    store.actions.toggle()
    expect(seen).toEqual([true, false, true, false])
  })
})
