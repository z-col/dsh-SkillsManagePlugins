/**
 * Real-composition integration test: boots a genuine cordis Context with the
 * official WebServer plugin, mounts dsh-skills-manager's host half against
 * stub sessions/loader services, and drives the /skills JSON API over real
 * HTTP against a scratch skill root. This is the "real composition" gate —
 * not a hand-rolled ctx.plugin() call.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { apply, name, inject } from '../src/index.ts'
import { userSkillsRoot } from '../src/skill-fs.ts'

/** One request helper against the booted webserver. */
async function post<T>(port: number, method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}/skills/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await response.json()) as { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } }
  if (!response.ok || body.ok !== true || body.value === undefined) {
    throw new Error(`${method} failed: ${body.error?.code ?? 'http'} ${body.error?.message ?? response.status}`)
  }
  return body.value as T
}

interface Entry { name: string; form: string; description: string; path: string }

describe('real composition: host API over HTTP', () => {
  let port: number
  let app: Context
  let pluginFiber: { dispose(): Promise<void> }
  let scratch: string
  let originalHome: string | undefined

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'dsh-skills-integration-'))
    // Point the DSH home at the scratch dir so user-level skills land there.
    originalHome = process.env.DSH_HOME
    process.env.DSH_HOME = scratch

    app = new Context()
    // Stub the two services the plugin injects that this composition lacks.
    const sessions = {
      get: (id: string) => id === 'session-1' ? { header: { cwd: scratch } } : undefined,
    }
    const loader = {
      entries: () => [{ options: { name: 'connection', config: { trustedHosts: [] } } }],
    }
    app.provide('sessions', sessions)
    app.provide('loader', loader)

    const webFiber = app.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await webFiber
    // Cast through unknown: the plugin's apply expects our augmented cordis
    // Context (declared module 'cordis'), which differs nominally from the
    // @deepseek-ai/cordis Context here; the runtime shape is identical.
    const pluginObject: unknown = { name, inject, apply }
    pluginFiber = app.plugin(pluginObject as Parameters<typeof app.plugin>[0], {})
    await pluginFiber
    port = app.webServer.port
  })

  afterAll(async () => {
    await pluginFiber.dispose()
    await rm(scratch, { recursive: true, force: true })
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
  })

  it('reports the user root under the scratch home', async () => {
    const info = await post<{ userRoot: string; projectRoot: string; cwd: string }>(port, 'roots.info', { sessionId: 'session-1' })
    expect(info.userRoot).toBe(join(scratch, 'skills'))
    expect(info.cwd).toBe(scratch)
  })

  it('lists an empty user root', async () => {
    const entries = await post<Entry[]>(port, 'skills.list', { sessionId: 'session-1', root: 'user' })
    expect(entries).toEqual([])
  })

  it('creates, reads, updates, renames, deletes a user skill', async () => {
    // Create
    const created = await post<{ name: string; path: string }>(port, 'skills.create', {
      sessionId: 'session-1', root: 'user', name: 'demo-skill', description: 'Demo skill', body: 'do things',
    })
    expect(created.name).toBe('demo-skill')
    expect(created.path).toContain('demo-skill')

    // List
    const list = await post<Entry[]>(port, 'skills.list', { sessionId: 'session-1', root: 'user' })
    expect(list).toHaveLength(1)
    expect(list[0]?.name).toBe('demo-skill')
    expect(list[0]?.form).toBe('bundle')

    // Read
    const file = await post<{ name: string; description: string; body: string; raw: string }>(port, 'skills.get', {
      sessionId: 'session-1', root: 'user', name: 'demo-skill',
    })
    expect(file.description).toBe('Demo skill')
    expect(file.body).toBe('do things')

    // Update (rewrite raw with new body)
    const updatedRaw = file.raw.replace('do things', 'do better things')
    await post<{ ok: true }>(port, 'skills.update', {
      sessionId: 'session-1', root: 'user', name: 'demo-skill', content: updatedRaw,
    })
    const afterUpdate = await post<{ body: string }>(port, 'skills.get', {
      sessionId: 'session-1', root: 'user', name: 'demo-skill',
    })
    expect(afterUpdate.body).toBe('do better things')

    // Rename
    const renamed = await post<{ name: string }>(port, 'skills.rename', {
      sessionId: 'session-1', root: 'user', name: 'demo-skill', newName: 'renamed-skill',
    })
    expect(renamed.name).toBe('renamed-skill')
    const afterRename = await post<{ name: string }>(port, 'skills.get', {
      sessionId: 'session-1', root: 'user', name: 'renamed-skill',
    })
    expect(afterRename.name).toBe('renamed-skill')

    // Delete
    await post<{ ok: true }>(port, 'skills.delete', {
      sessionId: 'session-1', root: 'user', name: 'renamed-skill',
    })
    const afterDelete = await post<Entry[]>(port, 'skills.list', { sessionId: 'session-1', root: 'user' })
    expect(afterDelete).toEqual([])
  })

  it('rejects an unknown method with 404', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/skills/api/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1' }),
    })
    expect(response.status).toBe(404)
  })

  it('fences cross-site requests', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/skills/api/skills.list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
      body: JSON.stringify({ sessionId: 'session-1', root: 'user' }),
    })
    expect(response.status).toBe(403)
  })

  it('lists project skills from the session cwd project root', async () => {
    // The session cwd is scratch; without a .git marker the project root IS
    // the cwd, so the project skill root is scratch/.dsh/skills.
    await mkdir(join(scratch, '.dsh', 'skills', 'proj-skill'), { recursive: true })
    await writeFile(join(scratch, '.dsh', 'skills', 'proj-skill', 'SKILL.md'),
      '---\nname: proj-skill\ndescription: Project skill\n---\nproject body\n')
    const entries = await post<Entry[]>(port, 'skills.list', { sessionId: 'session-1', root: 'project' })
    expect(entries.some(entry => entry.name === 'proj-skill')).toBe(true)
  })
})

/** Guard: the module must carry the identity the cordis row expects. */
describe('module contract', () => {
  it('declares the plugin name and inject list', () => {
    expect(name).toBe('dsh-skills-manager')
    expect(inject).toEqual(expect.arrayContaining(['webServer', 'sessions', 'loader']))
  })

  it('resolves the user root under the DSH home', () => {
    expect(userSkillsRoot()).toMatch(/skills$/)
  })
})
