/**
 * Skill filesystem operations for dsh-skills-manager: resolve the user and
 * project skill roots, scan a root for skill entries (directory bundles with
 * SKILL.md or flat <name>.md files), parse SKILL.md frontmatter, and provide
 * the CRUD primitives (create with no-clobber, atomic update, delete,
 * rename). All paths are validated to stay inside the owning root.
 */
import { access, copyFile, cp, lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve as resolvePath, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { SkillsError } from './wire.ts'

/** The skill root kinds the manager addresses. */
export type SkillRootKind = 'user' | 'project'

/** One skill entry discovered under a root. */
export interface SkillEntry {
  /** Kebab-case skill name (the directory or file base name). */
  name: string
  /** The SKILL.md (bundle) or <name>.md (flat) absolute path. */
  path: string
  /** The skill body directory (bundle: <name>/; flat: the root). */
  directory: string
  /** Bundle skills own a directory with SKILL.md; flat skills are one .md file. */
  form: 'bundle' | 'flat'
  /** Frontmatter description. */
  description: string
  /** Optional frontmatter whenToUse. */
  whenToUse?: string
}

/** A full skill file read: raw text plus parsed frontmatter fields. */
export interface SkillFileContent {
  name: string
  description: string
  whenToUse?: string
  /** The raw SKILL.md text (frontmatter + body). */
  raw: string
  /** The markdown body after the closing frontmatter fence. */
  body: string
}

/** Frontmatter fields accepted when creating a skill. */
export interface SkillCreateInput {
  name: string
  description: string
  whenToUse?: string
  body?: string
}

/** Resolve the user skill root: <$DSH_HOME>/skills. */
export function userSkillsRoot(): string {
  return join(resolveDshHome(), 'skills')
}

/**
 * Find the project root for a cwd: walk up to the nearest ancestor holding a
 * `.git` entry; when none exists, the cwd itself is the project root (the
 * same rule as @deepseek-ai/dsh-skill-filesystem's findProjectRoot).
 */
export async function findProjectRoot(cwd: string): Promise<string> {
  let current = resolvePath(cwd)
  for (;;) {
    try {
      await access(join(current, '.git'))
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolvePath(cwd)
      current = parent
    }
  }
}

/** Resolve the project skill root: <projectRoot>/.dsh/skills. */
export function projectSkillsRoot(projectRoot: string): string {
  return join(resolvePath(projectRoot), '.dsh', 'skills')
}

/** Assert that `candidate` resolves inside `root` (realpath-canonical on the root). */
export function assertWithinRoot(root: string, candidate: string): string {
  const rootResolved = resolvePath(root)
  const candidateResolved = resolvePath(candidate)
  if (candidateResolved === rootResolved) {
    throw new SkillsError('forbidden', `path "${candidate}" is the root itself`, 403)
  }
  if (!candidateResolved.startsWith(rootResolved + sep)) {
    throw new SkillsError('forbidden', `path "${candidate}" escapes root "${root}"`, 403)
  }
  return candidateResolved
}

/** Assert a skill name follows the public kebab-case grammar. */
export function assertSkillName(name: string): string {
  if (!isSkillName(name)) {
    throw new SkillsError('bad-request', `invalid skill name "${name}" (expected kebab-case)`)
  }
  return name
}

/** Resolve the absolute SKILL.md path for a bundle skill under a root. */
export function bundleSkillPath(root: string, name: string): string {
  const dir = join(resolvePath(root), assertSkillName(name))
  return join(dir, 'SKILL.md')
}

/** Resolve the absolute path for a flat skill file under a root. */
export function flatSkillPath(root: string, name: string): string {
  return join(resolvePath(root), `${assertSkillName(name)}.md`)
}

/**
 * Scan one skill root for skill entries. Missing or unreadable roots return
 * an empty list; the official provider treats them the same way.
 */
export async function scanSkillsRoot(root: string): Promise<SkillEntry[]> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return []
  }
  const entries: SkillEntry[] = []
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    if (name === '.system') continue
    const full = join(root, name)
    let stat: Awaited<ReturnType<typeof lstat>>
    try {
      stat = await lstat(full)
    } catch {
      continue
    }
    const path = stat.isDirectory()
      ? join(full, 'SKILL.md')
      : stat.isFile() && name.endsWith('.md') ? full : undefined
    if (path === undefined) continue
    try {
      await access(path)
    } catch {
      // Bundle without SKILL.md or vanished file: not a skill entry.
      continue
    }
    const skillName = stat.isDirectory() ? name : name.slice(0, -'.md'.length)
    if (!isSkillName(skillName)) continue
    entries.push({
      name: skillName,
      path,
      directory: stat.isDirectory() ? full : root,
      form: stat.isDirectory() ? 'bundle' : 'flat',
      description: '',
    })
  }
  // Read frontmatter descriptions in parallel (bounded by entry count). A
  // file the official provider would skip (missing/invalid frontmatter or no
  // description) is not a valid skill: drop the entry so the manager's view
  // matches the runtime catalog.
  const valid: boolean[] = await Promise.all(entries.map(async (entry) => {
    try {
      const content = await readSkillFile(entry.path)
      entry.description = content.description
      if (content.whenToUse !== undefined) entry.whenToUse = content.whenToUse
      return true
    } catch {
      return false
    }
  }))
  return entries.filter((_, index) => valid[index])
}

/**
 * Read and parse one skill file (SKILL.md or <name>.md). The official
 * provider requires frontmatter with `name` and `description`; a file
 * without them is not a valid skill. Returns the parsed content or throws
 * SkillsError not-found when the file is missing or malformed.
 */
export async function readSkillFile(path: string): Promise<SkillFileContent> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    throw new SkillsError('not-found', `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 404)
  }
  const parsed = parseSkillFrontmatter(raw)
  if (parsed === undefined) {
    throw new SkillsError('bad-request', `"${path}" is not a valid skill file (missing YAML frontmatter with name and description)`)
  }
  const name = stringField(parsed.data, 'name')
  const description = stringField(parsed.data, 'description')
  if (name === undefined || !isSkillName(name) || description === undefined) {
    throw new SkillsError('bad-request', `"${path}" frontmatter requires a kebab-case name and a description`)
  }
  return {
    name,
    description,
    ...optionalField(parsed.data, 'whenToUse'),
    raw,
    body: parsed.body.trim(),
  }
}

/** Serialize a skill file body with a complete frontmatter block. */
export function serializeSkillFile(input: SkillCreateInput): string {
  assertSkillName(input.name)
  if (input.description === '') {
    throw new SkillsError('bad-request', 'skill description must not be empty')
  }
  const data: Record<string, string> = {
    name: input.name,
    description: input.description,
  }
  if (input.whenToUse !== undefined && input.whenToUse !== '') data.whenToUse = input.whenToUse
  const fm = `---\n${Object.entries(data).map(([k, v]) => `${k}: ${yamlQuote(v)}`).join('\n')}\n---\n`
  const body = (input.body ?? '').trim()
  return fm + (body === '' ? '\n' : `${body}\n`)
}

/** Create a bundle skill (directory + SKILL.md) with no-clobber semantics. */
export async function createBundleSkill(root: string, input: SkillCreateInput): Promise<SkillEntry> {
  const dir = join(resolvePath(root), assertSkillName(input.name))
  // The skill root may not exist yet (a fresh ~/.dsh/skills): create the
  // root chain, then the skill directory — but never overwrite an existing
  // skill (no-clobber on the directory itself).
  try {
    await mkdir(resolvePath(root), { recursive: true })
  } catch (error) {
    throw new SkillsError('fs-error', `cannot create skill root "${root}": ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    await mkdir(dir, { recursive: false })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') {
      throw new SkillsError('conflict', `skill "${input.name}" already exists`, 409)
    }
    throw new SkillsError('fs-error', `cannot create skill directory "${dir}": ${error instanceof Error ? error.message : String(error)}`)
  }
  const path = join(dir, 'SKILL.md')
  try {
    await writeFileAtomic(path, serializeSkillFile(input), { mode: 0o644, dirMode: 0o755 })
  } catch (error) {
    throw new SkillsError('fs-error', `cannot write "${path}": ${error instanceof Error ? error.message : String(error)}`)
  }
  return { name: input.name, path, directory: dir, form: 'bundle', description: input.description }
}

/** Replace the full content of a skill file atomically. */
export async function updateSkillFile(path: string, raw: string): Promise<void> {
  const parsed = parseSkillFrontmatter(raw)
  if (parsed === undefined) {
    throw new SkillsError('bad-request', 'content must keep the YAML frontmatter with name and description')
  }
  const name = stringField(parsed.data, 'name')
  if (name === undefined || !isSkillName(name)) {
    throw new SkillsError('bad-request', 'frontmatter name must be a valid kebab-case skill name')
  }
  if (stringField(parsed.data, 'description') === undefined) {
    throw new SkillsError('bad-request', 'frontmatter description is required')
  }
  try {
    await writeFileAtomic(path, raw.endsWith('\n') ? raw : `${raw}\n`, { mode: 0o644 })
  } catch (error) {
    throw new SkillsError('fs-error', `cannot write "${path}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Delete a skill entry: the bundle directory (recursive) or the flat file. */
export async function deleteSkillEntry(entry: Pick<SkillEntry, 'directory' | 'form' | 'path'>): Promise<void> {
  try {
    await rm(entry.form === 'bundle' ? entry.directory : entry.path, { recursive: true, force: false })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new SkillsError('not-found', 'skill no longer exists', 404)
    }
    throw new SkillsError('fs-error', `cannot delete "${entry.path}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Rename a skill entry to a new kebab-case name (no-clobber on the target).
 *  The frontmatter `name` field is rewritten to match, because the runtime
 *  catalog derives the skill name from frontmatter, not from the directory. */
export async function renameSkillEntry(
  entry: Pick<SkillEntry, 'directory' | 'form' | 'name' | 'description' | 'path'>,
  root: string,
  newName: string,
): Promise<SkillEntry> {
  const target = assertSkillName(newName)
  const targetPath = entry.form === 'bundle'
    ? join(resolvePath(root), target)
    : join(resolvePath(root), `${target}.md`)
  try {
    await access(targetPath)
    throw new SkillsError('conflict', `skill "${newName}" already exists`, 409)
  } catch (error) {
    if (error instanceof SkillsError) throw error
    // ENOENT: the target is free — proceed.
  }
  try {
    await rename(entry.directory, targetPath)
  } catch (error) {
    throw new SkillsError('fs-error', `cannot rename "${entry.name}" to "${newName}": ${error instanceof Error ? error.message : String(error)}`)
  }
  const nextPath = entry.form === 'bundle' ? join(targetPath, 'SKILL.md') : targetPath
  try {
    const content = await readSkillFile(nextPath)
    await updateSkillFile(nextPath, rewriteFrontmatterName(content.raw, newName))
  } catch (error) {
    if (error instanceof SkillsError) throw error
    throw new SkillsError('fs-error', `cannot update frontmatter after renaming: ${error instanceof Error ? error.message : String(error)}`)
  }
  return entry.form === 'bundle'
    ? { name: newName, path: nextPath, directory: targetPath, form: 'bundle', description: entry.description }
    : { name: newName, path: nextPath, directory: root, form: 'flat', description: entry.description }
}

/**
 * Move a skill entry to another root (user ↔ project) with no-clobber
 * semantics: the target name must be free, and the copy happens BEFORE the
 * source is deleted, so a failed copy never loses the skill. The destination
 * root chain is created on demand (a fresh project root may not exist yet).
 * The frontmatter `name` field is unchanged — the skill keeps its identity.
 */
export async function moveSkillEntry(entry: SkillEntry, destRoot: string): Promise<SkillEntry> {
  const root = resolvePath(destRoot)
  const targetPath = entry.form === 'bundle'
    ? join(root, assertSkillName(entry.name))
    : join(root, `${assertSkillName(entry.name)}.md`)
  // Never move onto itself (e.g. user root and project root resolve to the
  // same directory in an odd layout) — that would silently delete the skill.
  if (resolvePath(targetPath) === resolvePath(entry.directory)) {
    throw new SkillsError('bad-request', 'source and destination are the same location')
  }
  try {
    await access(targetPath)
    throw new SkillsError('conflict', `skill "${entry.name}" already exists in the destination root`, 409)
  } catch (error) {
    if (error instanceof SkillsError) throw error
    // ENOENT: the destination name is free — proceed.
  }
  try {
    await mkdir(root, { recursive: true })
  } catch (error) {
    throw new SkillsError('fs-error', `cannot create destination root "${root}": ${error instanceof Error ? error.message : String(error)}`)
  }
  // Copy first; only delete the source after the copy fully lands.
  try {
    if (entry.form === 'bundle') {
      await cp(entry.directory, targetPath, { recursive: true })
    } else {
      await copyFile(entry.path, targetPath)
    }
  } catch (error) {
    throw new SkillsError('fs-error', `cannot copy skill "${entry.name}" to "${root}": ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    await rm(entry.form === 'bundle' ? entry.directory : entry.path, { recursive: true, force: false })
  } catch (error) {
    // The copy landed but the source cleanup failed: keep the duplicate and
    // report the partial state instead of pretending the move succeeded.
    throw new SkillsError('fs-error', `moved "${entry.name}" to "${root}" but could not remove the source: ${error instanceof Error ? error.message : String(error)}`)
  }
  return {
    name: entry.name,
    path: entry.form === 'bundle' ? join(targetPath, 'SKILL.md') : targetPath,
    directory: entry.form === 'bundle' ? targetPath : root,
    form: entry.form,
    description: entry.description,
    ...(entry.whenToUse !== undefined ? { whenToUse: entry.whenToUse } : {}),
  }
}

/** Replace the `name:` line inside the leading frontmatter block. */
function rewriteFrontmatterName(raw: string, newName: string): string {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return raw
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return raw
  const closing = findClosingFrontmatter(raw, firstLineEnd + 1)
  if (closing === undefined) return raw
  const head = raw.slice(0, closing.bodyStart)
  const tail = raw.slice(closing.bodyStart)
  const lines = head.split('\n')
  const out = lines.map(line => {
    if (/^name\s*:/.test(line)) return `name: ${newName}`
    return line
  })
  return out.join('\n') + tail
}

// ── frontmatter helpers (same contract as @deepseek-ai/dsh-skill-filesystem) ──

interface ParsedFrontmatter {
  data: Record<string, unknown>
  body: string
}

/** Parse leading `---` YAML frontmatter; undefined when absent or malformed. */
function parseSkillFrontmatter(raw: string): ParsedFrontmatter | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return undefined
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) return undefined
  let data: unknown
  try {
    data = parseYaml(raw.slice(start, closing.start))
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  return { data: data as Record<string, unknown>, body: raw.slice(closing.bodyStart) }
}

function findClosingFrontmatter(raw: string, start: number): { start: number; bodyStart: number } | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalField(data: Record<string, unknown>, key: string): { [key: string]: string } | {} {
  const value = stringField(data, key)
  return value === undefined ? {} : { [key]: value }
}

/** Quote a frontmatter scalar for YAML single-line safety. */
function yamlQuote(value: string): string {
  if (/^[A-Za-z0-9_\-./ ]+$/.test(value) && !value.startsWith('-') && !value.startsWith('!')) return value
  return JSON.stringify(value)
}
