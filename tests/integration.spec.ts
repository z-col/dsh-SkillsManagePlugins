/**
 * Real-composition integration test: boots a genuine cordis Context with the
 * official WebServer plugin, mounts dsh-skills-manager's host half against
 * stub sessions/loader services, and drives the /skills JSON API over real
 * HTTP against a scratch skill root. This is the "real composition" gate —
 * not a hand-rolled ctx.plugin() call.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises'
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

/** The wire shape of `skills.library.list`. */
interface LibraryView {
  skills: Array<{ name: string; form: string; description: string; assignments: Array<'user' | `project:${string}`> }>
  projects: Array<{ root: string; label: string }>
  currentProject: string
}

describe('real composition: host API over HTTP', () => {
  let port: number
  let app: Context
  let pluginFiber: { dispose(): Promise<void> }
  let scratch: string
  let originalHome: string | undefined
  let originalNoOpen: string | undefined

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'dsh-skills-integration-'))
    // Point the DSH home at the scratch dir so user-level skills land there.
    originalHome = process.env.DSH_HOME
    process.env.DSH_HOME = scratch
    // Never spawn a real file manager during tests.
    originalNoOpen = process.env.DSH_SKILLS_NO_OPEN
    process.env.DSH_SKILLS_NO_OPEN = '1'

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
    if (originalNoOpen === undefined) delete process.env.DSH_SKILLS_NO_OPEN
    else process.env.DSH_SKILLS_NO_OPEN = originalNoOpen
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

  it('creates, reads, updates, renames, deletes a library skill over HTTP', async () => {
    // Create: the canonical lands in the library (no assignment yet).
    const created = await post<{ name: string; path: string }>(port, 'skills.create', {
      sessionId: 'session-1', name: 'demo-skill', description: 'Demo skill', body: 'do things',
    })
    expect(created.name).toBe('demo-skill')
    expect(created.path).toContain('skill-library')

    // The library lists it as unassigned.
    const library = await post<LibraryView>(port, 'skills.library.list', { sessionId: 'session-1' })
    expect(library.skills.find(s => s.name === 'demo-skill')?.assignments).toEqual([])

    // Assign to the user level → a user copy appears.
    await post<{ name: string }>(port, 'skills.library.assign', {
      sessionId: 'session-1', name: 'demo-skill', to: 'user',
    })
    const library2 = await post<LibraryView>(port, 'skills.library.list', { sessionId: 'session-1' })
    expect(library2.skills.find(s => s.name === 'demo-skill')?.assignments).toEqual(['user'])

    // Read the user copy.
    const file = await post<{ name: string; description: string; body: string; raw: string }>(port, 'skills.get', {
      sessionId: 'session-1', root: 'user', name: 'demo-skill',
    })
    expect(file.description).toBe('Demo skill')
    expect(file.body).toBe('do things')

    // Update the user copy → the library canonical is refreshed too.
    const updatedRaw = file.raw.replace('do things', 'do better things')
    await post<{ ok: true }>(port, 'skills.update', {
      sessionId: 'session-1', root: 'user', name: 'demo-skill', content: updatedRaw,
    })
    const canonical = await post<{ body: string }>(port, 'skills.get', {
      sessionId: 'session-1', root: 'library', name: 'demo-skill',
    })
    expect(canonical.body).toBe('do better things')

    // Rename everywhere (canonical + the user copy).
    await post<{ name: string }>(port, 'skills.rename', {
      sessionId: 'session-1', name: 'demo-skill', newName: 'renamed-skill',
    })
    const library3 = await post<LibraryView>(port, 'skills.library.list', { sessionId: 'session-1' })
    expect(library3.skills.some(s => s.name === 'renamed-skill')).toBe(true)
    const renamedUser = await post<{ name: string }>(port, 'skills.get', {
      sessionId: 'session-1', root: 'user', name: 'renamed-skill',
    })
    expect(renamedUser.name).toBe('renamed-skill')

    // Delete everywhere: canonical + user copy are gone.
    await post<{ ok: true }>(port, 'skills.delete', { sessionId: 'session-1', name: 'renamed-skill' })
    const library4 = await post<LibraryView>(port, 'skills.library.list', { sessionId: 'session-1' })
    expect(library4.skills.some(s => s.name === 'renamed-skill')).toBe(false)
    const userList = await post<Entry[]>(port, 'skills.list', { sessionId: 'session-1', root: 'user' })
    expect(userList.some(entry => entry.name === 'renamed-skill')).toBe(false)
  })

  it('rejects an unknown method with 404', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/skills/api/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1' }),
    })
    expect(response.status).toBe(404)
  })

  it('assigns a skill to the project level and recycles it back (multi-assignment)', async () => {
    await post<{ name: string }>(port, 'skills.create', {
      sessionId: 'session-1', name: 'movable', description: 'Movable skill', body: 'move me', assignTo: ['user'],
    })

    // The session cwd IS the project root here (scratch has no .git marker).
    const library = await post<LibraryView>(port, 'skills.library.list', { sessionId: 'session-1' })
    expect(library.currentProject).toBe(scratch)
    expect(library.skills.find(s => s.name === 'movable')?.assignments).toEqual(['user'])

    // Assign to the current project as well → both assignments coexist.
    await post<{ name: string }>(port, 'skills.library.assign', {
      sessionId: 'session-1', name: 'movable', to: { project: library.currentProject },
    })
    const library2 = await post<LibraryView>(port, 'skills.library.list', { sessionId: 'session-1' })
    const entry2 = library2.skills.find(s => s.name === 'movable')
    expect(entry2?.assignments).toContain('user')
    expect(entry2?.assignments).toContain(`project:${scratch}`)

    // Recycle from the project: the user copy and the canonical survive.
    await post<{ ok: true }>(port, 'skills.library.recycle', {
      sessionId: 'session-1', name: 'movable', from: { project: scratch },
    })
    const library3 = await post<LibraryView>(port, 'skills.library.list', { sessionId: 'session-1' })
    expect(library3.skills.find(s => s.name === 'movable')?.assignments).toEqual(['user'])
    const projectList = await post<Entry[]>(port, 'skills.list', { sessionId: 'session-1', root: 'project' })
    expect(projectList.some(entry => entry.name === 'movable')).toBe(false)

    // Cleanup: recycle the user copy too, then delete the canonical.
    await post<{ ok: true }>(port, 'skills.recycle', { sessionId: 'session-1', root: 'user', name: 'movable' })
    await post<{ ok: true }>(port, 'skills.delete', { sessionId: 'session-1', name: 'movable' })
  })

  it('rejects recycling from the library root (level operation only)', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/skills/api/skills.recycle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', root: 'library', name: 'whatever' }),
    })
    expect(response.status).toBe(400)
  })

  it('rejects assigning to an unindexed project root', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/skills/api/skills.library.assign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', name: 'whatever', to: { project: '/unindexed/project' } }),
    })
    expect(response.status).toBe(400)
  })

  it('resolves and prepares the selected folder without opening it (no-open guard)', async () => {
    // DSH_SKILLS_NO_OPEN=1 (set in beforeAll) skips the real file-manager
    // spawn; the method must still resolve each level's path and ensure the
    // directory exists.
    const library = await post<{ ok: true; path: string }>(port, 'skills.openFolder', {
      sessionId: 'session-1', root: 'library',
    })
    expect(library.path).toBe(join(scratch, 'skill-library'))
    await access(join(scratch, 'skill-library'))

    const user = await post<{ ok: true; path: string }>(port, 'skills.openFolder', {
      sessionId: 'session-1', root: 'user',
    })
    expect(user.path).toBe(join(scratch, 'skills'))

    const project = await post<{ ok: true; path: string }>(port, 'skills.openFolder', {
      sessionId: 'session-1', root: 'project',
    })
    expect(project.path).toBe(join(scratch, '.dsh', 'skills'))
    await access(join(scratch, '.dsh', 'skills'))
  })

  it('rejects an invalid open-folder root kind', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/skills/api/skills.openFolder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', root: '/etc' }),
    })
    expect(response.status).toBe(400)
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
