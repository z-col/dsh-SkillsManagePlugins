/**
 * Profile-load guard: DSH refuses to mount a bundle whose `@deepseek-ai/dsh*`
 * peer ranges do not satisfy the RUNNING runtime — `dsh-app-boot`'s
 * `evaluatePluginCompatibility` compares every such peer against the dsh
 * version and, unless the exact `name@version` has a recorded exemption in the
 * profile's `compatibility.json`, throws; `loadProfileDirectory` catches that
 * and puts the whole bundle in `skippedBundles`. The only trace is one stderr
 * line, and the plugin then simply does not exist: no host row (its routes
 * vanish) and no client entry (so no view tab).
 *
 * That is exactly how v2.0.0 first shipped: the version bump orphaned the
 * recorded `dsh-skills-manager@1.0.0` exemption while every peer still said
 * `^0.1.0-rc.6` (a caret range cannot cross the 0.x minor, so it excludes
 * `0.2.0-rc.2`). This suite pins the peer ranges against every runtime the
 * package claims to support, so a version or range edit cannot silently skip
 * the bundle again.
 *
 * Semantics mirror the app: prereleases participate in ranges
 * (`includePrerelease: true`).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { satisfies, valid } from 'semver'
import { describe, expect, it } from 'vitest'

/** Every dsh runtime the package declares support for (README 兼容性 + CHANGELOG). */
const SUPPORTED_RUNTIMES = ['0.1.7-rc.2', '0.2.0-rc.2']

/** The manifest under test. */
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as {
  name: string
  version: string
  peerDependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string }, client?: { platform?: string, inject?: string[] } }
}

/** The peers the compatibility gate inspects (`@deepseek-ai/dsh`, `@deepseek-ai/dsh-*`). */
function dshPeers(): Array<[string, string]> {
  return Object.entries(manifest.peerDependencies ?? {})
    .filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
}

describe('profile-load compatibility (dsh peer ranges)', () => {
  it('declares dsh peers at all (the gate is the only thing standing between a bundle and being skipped)', () => {
    expect(dshPeers().length).toBeGreaterThan(0)
  })

  it.each(SUPPORTED_RUNTIMES)('every dsh peer satisfies dsh %s without an exemption', (runtime) => {
    expect(valid(runtime)).toBe(runtime)
    const incompatible = dshPeers()
      .filter(([, range]) => !satisfies(runtime, range, { includePrerelease: true }))
      .map(([name, range]) => `${name}@${range}`)
    expect(incompatible).toEqual([])
  })

  it('does not name a peer package that the 0.2 line dropped', () => {
    // @deepseek-ai/dsh-client-runtime stopped at the 0.1.0-rc.x line: its client
    // services were folded into @deepseek-ai/dsh-api-session-controller etc.
    expect(dshPeers().map(([name]) => name)).not.toContain('@deepseek-ai/dsh-client-runtime')
  })

  it('keeps the identity the profile exemption would key on', () => {
    // Documented on purpose: a version bump changes `name@version`, so any
    // recorded exemption stops applying — the peer ranges must stand alone.
    expect(`${manifest.name}@${manifest.version}`).toBe('dsh-skills-manager@2.0.0')
  })

  it('keeps the bundle + client entry points the profile loader resolves', () => {
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh?.client?.platform).toBe('web')
    expect(manifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-conversation')
  })
})
