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
  bundleSkillPath,
  createBundleSkill,
  deleteSkillEntry,
  flatSkillPath,
  readSkillFile,
  renameSkillEntry,
  scanSkillsRoot,
  serializeSkillFile,
  updateSkillFile,
  userSkillsRoot,
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
