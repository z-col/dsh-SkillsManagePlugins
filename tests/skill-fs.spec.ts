/**
 * Tests for the skill filesystem operations: root resolution, scanning
 * (bundle + flat forms), frontmatter parsing, create/update/delete/rename
 * round trips, and path-containment fences.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertSkillName,
  assignmentTargetsOf,
  bundleSkillPath,
  copySkillEntryToRoot,
  createBundleSkill,
  deleteSkillEverywhere,
  deleteSkillEntry,
  flatSkillPath,
  librarySkillsRoot,
  readProjectIndex,
  readSkillFile,
  reconcileLibrary,
  recordProjectRoot,
  recycleSkillFromRoot,
  renameSkillEverywhere,
  renameSkillEntry,
  scanSkillsRoot,
  serializeSkillFile,
  skillExistsInRoot,
  syncSkillEntry,
  updateSkillFile,
  userSkillsRoot,
  projectSkillsRoot,
  assertWithinRoot,
  findProjectRoot,
} from '../src/skill-fs.ts'
import { SkillsError } from '../src/wire.ts'

/** A scratch root per test. */
async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-skills-manager-test-'))
}

/** A valid skill file's full text for a bundle skill. */
function skillText(name: string, description: string, body = 'instructions'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`
}

describe('skill name and path fences', () => {
  it('accepts kebab-case names', () => {
    expect(assertSkillName('my-skill')).toBe('my-skill')
    expect(assertSkillName('a1-b2')).toBe('a1-b2')
  })

  it('rejects invalid names', () => {
    for (const bad of ['My Skill', 'my_skill', '..', 'a b', '', '-x', 'a/../../etc']) {
      expect(() => assertSkillName(bad)).toThrow(SkillsError)
    }
  })

  it('builds bundle and flat paths under a root', () => {
    expect(bundleSkillPath('/root', 'demo')).toBe('/root/demo/SKILL.md')
    expect(flatSkillPath('/root', 'demo')).toBe('/root/demo.md')
  })

  it('fences paths outside the root', () => {
    expect(() => assertWithinRoot('/a/b', '/a/b/c')).not.toThrow()
    expect(() => assertWithinRoot('/a/b', '/a/b')).toThrow(SkillsError)
    expect(() => assertWithinRoot('/a/b', '/a/bc')).toThrow(SkillsError)
    expect(() => assertWithinRoot('/a/b', '/a')).toThrow(SkillsError)
  })
})

describe('serializeSkillFile', () => {
  it('writes frontmatter with name/description and a body', () => {
    const text = serializeSkillFile({ name: 'demo', description: 'Demo skill', body: 'do the thing' })
    expect(text).toContain('name: demo')
    expect(text).toContain('description: Demo skill')
    expect(text).toContain('do the thing')
  })

  it('quotes values containing colons or special characters', () => {
    const text = serializeSkillFile({ name: 'demo', description: 'A: skill (demo)' })
    expect(text).toContain('description: "A: skill (demo)"')
  })

  it('rejects empty description', () => {
    expect(() => serializeSkillFile({ name: 'demo', description: '' })).toThrow(SkillsError)
  })
})

describe('scanSkillsRoot', () => {
  it('discovers bundle and flat skills with parsed descriptions', async () => {
    const root = await scratch()
    await mkdir(join(root, 'alpha'), { recursive: true })
    await writeFile(join(root, 'alpha', 'SKILL.md'), skillText('alpha', 'Alpha skill'))
    await writeFile(join(root, 'beta.md'), skillText('beta', 'Beta skill'))
    const entries = await scanSkillsRoot(root)
    expect(entries).toHaveLength(2)
    const alpha = entries.find(e => e.name === 'alpha')
    const beta = entries.find(e => e.name === 'beta')
    expect(alpha?.form).toBe('bundle')
    expect(alpha?.description).toBe('Alpha skill')
    expect(beta?.form).toBe('flat')
    expect(beta?.description).toBe('Beta skill')
    await rm(root, { recursive: true, force: true })
  })

  it('skips non-skill files and bundle directories without SKILL.md', async () => {
    const root = await scratch()
    await writeFile(join(root, 'readme.md'), 'no frontmatter')
    await writeFile(join(root, 'notes.txt'), 'plain text')
    await mkdir(join(root, 'empty-dir'), { recursive: true })
    expect(await scanSkillsRoot(root)).toHaveLength(0)
    await rm(root, { recursive: true, force: true })
  })

  it('returns an empty list for a missing root', async () => {
    expect(await scanSkillsRoot(join(tmpdir(), 'definitely-missing-root'))).toEqual([])
  })
})

describe('readSkillFile', () => {
  it('parses name, description, and body', async () => {
    const root = await scratch()
    const path = join(root, 'demo.md')
    await writeFile(path, skillText('demo', 'Demo skill', 'body here'))
    const content = await readSkillFile(path)
    expect(content.name).toBe('demo')
    expect(content.description).toBe('Demo skill')
    expect(content.body).toBe('body here')
    expect(content.raw).toContain('---')
    await rm(root, { recursive: true, force: true })
  })

  it('throws not-found for a missing file', async () => {
    await expect(readSkillFile('/no/such/file.md')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('throws bad-request for a file without frontmatter', async () => {
    const root = await scratch()
    const path = join(root, 'plain.md')
    await writeFile(path, 'just text')
    await expect(readSkillFile(path)).rejects.toMatchObject({ code: 'bad-request' })
    await rm(root, { recursive: true, force: true })
  })
})

describe('createBundleSkill / updateSkillFile / deleteSkillEntry', () => {
  it('creates a bundle skill, updates its content, and deletes it', async () => {
    const root = await scratch()
    const entry = await createBundleSkill(root, { name: 'demo', description: 'Demo' })
    expect(entry.form).toBe('bundle')
    expect((await readFile(entry.path, 'utf8')).includes('name: demo')).toBe(true)

    await updateSkillFile(entry.path, skillText('demo', 'Updated', 'new body'))
    expect((await readSkillFile(entry.path)).body).toBe('new body')

    await deleteSkillEntry(entry)
    await expect(readFile(entry.path, 'utf8')).rejects.toThrow()
    await rm(root, { recursive: true, force: true })
  })

  it('refuses to overwrite an existing skill (no-clobber)', async () => {
    const root = await scratch()
    await createBundleSkill(root, { name: 'demo', description: 'Demo' })
    await expect(createBundleSkill(root, { name: 'demo', description: 'Again' })).rejects.toMatchObject({ code: 'conflict' })
    await rm(root, { recursive: true, force: true })
  })

  it('rejects an update whose content drops the frontmatter', async () => {
    const root = await scratch()
    const entry = await createBundleSkill(root, { name: 'demo', description: 'Demo' })
    await expect(updateSkillFile(entry.path, 'no frontmatter here')).rejects.toMatchObject({ code: 'bad-request' })
    await rm(root, { recursive: true, force: true })
  })
})

describe('renameSkillEntry', () => {
  it('renames a bundle directory and returns the new path', async () => {
    const root = await scratch()
    const entry = await createBundleSkill(root, { name: 'old-name', description: 'Demo' })
    const next = await renameSkillEntry({ ...entry, description: entry.description }, root, 'new-name')
    expect(next.name).toBe('new-name')
    expect((await readFile(next.path, 'utf8')).includes('old-name')).toBe(false)
    await rm(root, { recursive: true, force: true })
  })

  it('refuses to rename onto an existing name', async () => {
    const root = await scratch()
    await createBundleSkill(root, { name: 'a', description: 'A' })
    const b = await createBundleSkill(root, { name: 'b', description: 'B' })
    await expect(renameSkillEntry({ ...b, description: b.description }, root, 'a')).rejects.toMatchObject({ code: 'conflict' })
    await rm(root, { recursive: true, force: true })
  })
})

/** Point DSH_HOME at a scratch dir for the duration of one callback. */
async function withDshHome<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    return await fn()
  } finally {
    if (original === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = original
  }
}

describe('skill library (canonical store + assignments)', () => {
  it('records and reads project roots in the index (idempotent)', async () => {
    const home = await scratch()
    await withDshHome(home, async () => {
      expect(await readProjectIndex()).toEqual([])
      await recordProjectRoot('/proj/a')
      await recordProjectRoot('/proj/b')
      await recordProjectRoot('/proj/a')
      expect(await readProjectIndex()).toEqual(['/proj/a', '/proj/b'])
    })
    await rm(home, { recursive: true, force: true })
  })

  it('reconciles existing user and project skills into the library (bundle form)', async () => {
    const home = await scratch()
    await withDshHome(home, async () => {
      await createBundleSkill(userSkillsRoot(), { name: 'user-skill', description: 'From user' })
      const projectRoot = join(home, 'proj')
      await mkdir(join(projectRoot, '.dsh', 'skills'), { recursive: true })
      await writeFile(join(projectRoot, '.dsh', 'skills', 'proj-skill.md'), skillText('proj-skill', 'From project'))
      await reconcileLibrary([projectRoot])
      const lib = await scanSkillsRoot(librarySkillsRoot())
      expect(lib.map(entry => entry.name).sort()).toEqual(['proj-skill', 'user-skill'])
      // Flat project skills are canonicalized to bundle form in the library.
      const proj = lib.find(entry => entry.name === 'proj-skill')
      expect(proj?.form).toBe('bundle')
      expect(await readFile(join(librarySkillsRoot(), 'proj-skill', 'SKILL.md'), 'utf8')).toContain('From project')
      // Idempotent: a second pass adds nothing.
      await reconcileLibrary([projectRoot])
      expect(await scanSkillsRoot(librarySkillsRoot())).toHaveLength(2)
    })
    await rm(home, { recursive: true, force: true })
  })

  it('assigns a library skill to a project (copy; canonical survives)', async () => {
    const home = await scratch()
    await withDshHome(home, async () => {
      await createBundleSkill(librarySkillsRoot(), { name: 'demo', description: 'Demo' })
      const canonical = (await scanSkillsRoot(librarySkillsRoot()))[0]!
      const projectRoot = join(home, 'proj')
      const copied = await copySkillEntryToRoot(canonical, projectSkillsRoot(projectRoot))
      expect(copied.path).toBe(join(projectRoot, '.dsh', 'skills', 'demo', 'SKILL.md'))
      expect(await scanSkillsRoot(librarySkillsRoot())).toHaveLength(1)
      expect(await assignmentTargetsOf(canonical, [projectRoot])).toEqual([`project:${projectRoot}`])
      // The user copy is absent, so 'user' is not an assignment yet.
      expect(await skillExistsInRoot(userSkillsRoot(), 'demo')).toBe(false)
    })
    await rm(home, { recursive: true, force: true })
  })

  it('refuses to assign onto an existing name and overwrites on sync', async () => {
    const home = await scratch()
    await withDshHome(home, async () => {
      await createBundleSkill(librarySkillsRoot(), { name: 'demo', description: 'v2' })
      const entry = (await scanSkillsRoot(librarySkillsRoot()))[0]!
      const projectRoot = join(home, 'proj')
      const dest = projectSkillsRoot(projectRoot)
      await createBundleSkill(dest, { name: 'demo', description: 'v1' })
      await expect(copySkillEntryToRoot(entry, dest)).rejects.toMatchObject({ code: 'conflict' })
      // The copy stays untouched by a failed assign.
      expect((await readSkillFile(join(dest, 'demo', 'SKILL.md'))).description).toBe('v1')
      // Sync overwrites the copy with the canonical.
      await syncSkillEntry(entry, [projectRoot])
      expect((await readSkillFile(join(dest, 'demo', 'SKILL.md'))).description).toBe('v2')
    })
    await rm(home, { recursive: true, force: true })
  })

  it('recycles a copy but keeps the canonical', async () => {
    const home = await scratch()
    await withDshHome(home, async () => {
      const canonical = await createBundleSkill(librarySkillsRoot(), { name: 'demo', description: 'Demo' })
      const projectRoot = join(home, 'proj')
      await copySkillEntryToRoot(canonical, projectSkillsRoot(projectRoot))
      await recycleSkillFromRoot('demo', projectSkillsRoot(projectRoot))
      expect(await skillExistsInRoot(projectSkillsRoot(projectRoot), 'demo')).toBe(false)
      expect(await scanSkillsRoot(librarySkillsRoot())).toHaveLength(1)
      // Recycling an absent copy is a not-found error.
      await expect(recycleSkillFromRoot('demo', projectSkillsRoot(projectRoot))).rejects.toMatchObject({ code: 'not-found' })
    })
    await rm(home, { recursive: true, force: true })
  })

  it('deletes a skill everywhere (library + user + projects)', async () => {
    const home = await scratch()
    await withDshHome(home, async () => {
      const canonical = await createBundleSkill(librarySkillsRoot(), { name: 'demo', description: 'Demo' })
      await copySkillEntryToRoot(canonical, userSkillsRoot())
      const projectRoot = join(home, 'proj')
      await copySkillEntryToRoot(canonical, projectSkillsRoot(projectRoot))
      await deleteSkillEverywhere('demo', [projectRoot])
      expect(await scanSkillsRoot(librarySkillsRoot())).toHaveLength(0)
      expect(await scanSkillsRoot(userSkillsRoot())).toHaveLength(0)
      expect(await scanSkillsRoot(projectSkillsRoot(projectRoot))).toHaveLength(0)
      await expect(deleteSkillEverywhere('demo', [projectRoot])).rejects.toMatchObject({ code: 'not-found' })
    })
    await rm(home, { recursive: true, force: true })
  })

  it('renames a skill everywhere and rewrites the frontmatter name', async () => {
    const home = await scratch()
    await withDshHome(home, async () => {
      await createBundleSkill(librarySkillsRoot(), { name: 'old-name', description: 'Demo' })
      const projectRoot = join(home, 'proj')
      await copySkillEntryToRoot((await scanSkillsRoot(librarySkillsRoot()))[0]!, projectSkillsRoot(projectRoot))
      await renameSkillEverywhere('old-name', 'new-name', [projectRoot])
      expect((await scanSkillsRoot(librarySkillsRoot())).map(entry => entry.name)).toEqual(['new-name'])
      expect((await scanSkillsRoot(projectSkillsRoot(projectRoot))).map(entry => entry.name)).toEqual(['new-name'])
      expect((await readSkillFile(join(projectSkillsRoot(projectRoot), 'new-name', 'SKILL.md'))).name).toBe('new-name')
    })
    await rm(home, { recursive: true, force: true })
  })

  it('refuses to rename onto a name that exists anywhere', async () => {
    const home = await scratch()
    await withDshHome(home, async () => {
      await createBundleSkill(librarySkillsRoot(), { name: 'a', description: 'A' })
      await createBundleSkill(librarySkillsRoot(), { name: 'b', description: 'B' })
      await expect(renameSkillEverywhere('a', 'b', [])).rejects.toMatchObject({ code: 'conflict' })
    })
    await rm(home, { recursive: true, force: true })
  })
})

describe('root resolution', () => {
  it('resolves the user root under the DSH home', () => {
    expect(userSkillsRoot()).toMatch(/skills$/)
  })

  it('finds a project root by .git marker', async () => {
    const root = await scratch()
    await mkdir(join(root, '.git'), { recursive: true })
    await mkdir(join(root, 'sub', 'deep'), { recursive: true })
    expect(await findProjectRoot(join(root, 'sub', 'deep'))).toBe(root)
    await rm(root, { recursive: true, force: true })
  })

  it('falls back to the cwd when no .git exists', async () => {
    const root = await scratch()
    expect(await findProjectRoot(join(root, 'sub'))).toBe(join(root, 'sub'))
    await rm(root, { recursive: true, force: true })
  })
})
