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

// ── Skill library (canonical store) + project index ────────────────────────
//
// The library is the authoritative home of every skill: <$DSH_HOME>/skill-library.
// The user root (~/.dsh/skills) and each project root (<root>/.dsh/skills) hold
// COPIES — an assignment. A skill can be assigned to the user level and to any
// number of projects at once; unassigning (recycling) removes a copy while the
// library canonical survives.

/** The canonical skill-library root: <$DSH_HOME>/skill-library. */
export function librarySkillsRoot(): string {
  return join(resolveDshHome(), 'skill-library')
}

/** The skills-manager state index: <$DSH_HOME>/skills-manager/index.json. */
export function skillsIndexPath(): string {
  return join(resolveDshHome(), 'skills-manager', 'index.json')
}

/** Read the recorded project roots from the index (missing/corrupt → []). */
export async function readProjectIndex(): Promise<string[]> {
  try {
    const raw = await readFile(skillsIndexPath(), 'utf8')
    const parsed = JSON.parse(raw) as { projects?: unknown } | null
    if (parsed === null || !Array.isArray(parsed.projects)) return []
    return parsed.projects
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      .map(entry => resolvePath(entry))
  } catch {
    return []
  }
}

/** Record a project root into the index (idempotent; atomic write). */
export async function recordProjectRoot(root: string): Promise<void> {
  const projects = await readProjectIndex()
  const canonical = resolvePath(root)
  if (projects.some(project => project === canonical)) return
  projects.push(canonical)
  projects.sort((a, b) => a.localeCompare(b))
  const indexPath = skillsIndexPath()
  await mkdir(dirname(indexPath), { recursive: true })
  await writeFileAtomic(indexPath, JSON.stringify({ version: 1, projects }, null, 2) + '\n', { mode: 0o644 })
}

/** Whether a skill name exists in a root (bundle directory or flat file). */
export async function skillExistsInRoot(root: string, name: string): Promise<boolean> {
  const skillName = assertSkillName(name)
  for (const candidate of [join(root, skillName), join(root, `${skillName}.md`)]) {
    try {
      await access(candidate)
      return true
    } catch {
      // absent — try the next form
    }
  }
  return false
}

/** Remove a skill name from a root (bundle directory or flat file). Throws
 *  not-found when neither form is present. */
export async function removeSkillNameFromRoot(root: string, name: string): Promise<void> {
  const skillName = assertSkillName(name)
  let removed = false
  try {
    await rm(join(root, skillName), { recursive: true, force: false })
    removed = true
  } catch {
    // not a bundle directory
  }
  if (!removed) {
    try {
      await rm(join(root, `${skillName}.md`), { force: false })
      removed = true
    } catch {
      // not a flat file
    }
  }
  if (!removed) {
    throw new SkillsError('not-found', `skill "${name}" is not present in this root`, 404)
  }
}

/** Copy a skill entry into a destination root, preserving its form. With
 *  `overwrite` an existing copy is replaced (the stale opposite form is
 *  removed first); otherwise the target must be free (no-clobber → conflict).
 *  The destination root chain is created on demand. */
export async function copySkillEntryToRoot(
  entry: Pick<SkillEntry, 'name' | 'form' | 'directory' | 'path' | 'description'>,
  destRoot: string,
  options: { overwrite?: boolean } = {},
): Promise<SkillEntry> {
  const root = resolvePath(destRoot)
  const name = assertSkillName(entry.name)
  if (await skillExistsInRoot(root, name)) {
    if (options.overwrite !== true) {
      throw new SkillsError('conflict', `skill "${name}" already exists in the destination root`, 409)
    }
    await removeSkillNameFromRoot(root, name)
  }
  await mkdir(root, { recursive: true })
  const target = entry.form === 'bundle'
    ? join(root, name)
    : join(root, `${name}.md`)
  try {
    if (entry.form === 'bundle') {
      await cp(entry.directory, target, { recursive: true })
    } else {
      await copyFile(entry.path, target)
    }
  } catch (error) {
    throw new SkillsError('fs-error', `cannot copy skill "${name}": ${error instanceof Error ? error.message : String(error)}`)
  }
  return {
    name,
    path: entry.form === 'bundle' ? join(target, 'SKILL.md') : target,
    directory: entry.form === 'bundle' ? target : root,
    form: entry.form,
    description: entry.description ?? '',
  }
}

/** Import one skill entry into the canonical library, normalized to bundle
 *  form (so the library never holds two entries with the same name). */
async function importSkillToLibrary(entry: SkillEntry): Promise<void> {
  const lib = librarySkillsRoot()
  const targetDir = join(lib, assertSkillName(entry.name))
  await mkdir(lib, { recursive: true })
  try {
    if (entry.form === 'bundle') {
      await cp(entry.directory, targetDir, { recursive: true })
    } else {
      await mkdir(targetDir, { recursive: false })
      await writeFileAtomic(join(targetDir, 'SKILL.md'), await readFile(entry.path, 'utf8'), { mode: 0o644 })
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return // another form was already imported under this name
    throw new SkillsError('fs-error', `cannot import skill "${entry.name}" into the library: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Reconcile the library with the user root and every recorded project root:
 *  skills present in those roots but missing from the library are copied in
 *  (canonicalized as bundle form). Idempotent; missing roots are skipped. */
export async function reconcileLibrary(projectRoots: string[]): Promise<void> {
  const lib = librarySkillsRoot()
  await mkdir(lib, { recursive: true })
  const seen = new Set<string>()
  for (const entry of await scanSkillsRoot(lib)) seen.add(entry.name)
  const roots = [userSkillsRoot(), ...projectRoots.map(projectSkillsRoot)]
  for (const root of roots) {
    let entries: SkillEntry[]
    try {
      entries = await scanSkillsRoot(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (seen.has(entry.name)) continue
      try {
        await importSkillToLibrary(entry)
        seen.add(entry.name)
      } catch {
        // keep going — one unreadable skill must not block reconciliation
      }
    }
  }
}

/** The assignment targets of a canonical skill: 'user' and/or 'project:<root>'
 *  for every root where a copy currently exists. */
export async function assignmentTargetsOf(
  entry: Pick<SkillEntry, 'name'>,
  projectRoots: string[],
): Promise<Array<'user' | `project:${string}`>> {
  const targets: Array<'user' | `project:${string}`> = []
  if (await skillExistsInRoot(userSkillsRoot(), entry.name)) targets.push('user')
  for (const projectRootPath of projectRoots) {
    if (await skillExistsInRoot(projectSkillsRoot(projectRootPath), entry.name)) {
      targets.push(`project:${projectRootPath}`)
    }
  }
  return targets
}

/** Push the canonical library copy to every root where the skill is assigned
 *  (overwrite). Returns the refreshed targets. */
export async function syncSkillEntry(
  entry: SkillEntry,
  projectRoots: string[],
): Promise<Array<'user' | `project:${string}`>> {
  const targets = await assignmentTargetsOf(entry, projectRoots)
  for (const target of targets) {
    const destRoot = target === 'user'
      ? userSkillsRoot()
      : projectSkillsRoot(target.slice('project:'.length))
    await copySkillEntryToRoot(entry, destRoot, { overwrite: true })
  }
  return targets
}

/** Recycle a skill from one level root (user or project): remove the copy,
 *  keep the library canonical. */
export async function recycleSkillFromRoot(name: string, destRoot: string): Promise<void> {
  await removeSkillNameFromRoot(resolvePath(destRoot), assertSkillName(name))
}

/** Delete a skill everywhere: the library canonical, the user root, and every
 *  recorded project root. Throws not-found when the skill is nowhere. */
export async function deleteSkillEverywhere(name: string, projectRoots: string[]): Promise<void> {
  const skillName = assertSkillName(name)
  const roots = [librarySkillsRoot(), userSkillsRoot(), ...projectRoots.map(projectSkillsRoot)]
  let removed = 0
  for (const root of roots) {
    if (await skillExistsInRoot(root, skillName)) {
      await removeSkillNameFromRoot(root, skillName)
      removed += 1
    }
  }
  if (removed === 0) {
    throw new SkillsError('not-found', `skill "${name}" not found`, 404)
  }
}

/** Rename a skill in a single root (bundle directory or flat file), rewriting
 *  the frontmatter name (no-clobber on the target in this root). */
export async function renameSkillInRoot(root: string, name: string, newName: string): Promise<void> {
  const rootResolved = resolvePath(root)
  const target = assertSkillName(newName)
  if (await skillExistsInRoot(rootResolved, target)) {
    throw new SkillsError('conflict', `skill "${newName}" already exists`, 409)
  }
  const sourceDir = join(rootResolved, name)
  const sourceFile = join(rootResolved, `${name}.md`)
  let sourcePath: string
  let isBundle: boolean
  try {
    await access(sourceDir)
    sourcePath = sourceDir
    isBundle = true
  } catch {
    try {
      await access(sourceFile)
      sourcePath = sourceFile
      isBundle = false
    } catch {
      throw new SkillsError('not-found', `skill "${name}" not found in this root`, 404)
    }
  }
  try {
    await rename(sourcePath, isBundle ? join(rootResolved, target) : join(rootResolved, `${target}.md`))
  } catch (error) {
    throw new SkillsError('fs-error', `cannot rename "${name}" to "${newName}": ${error instanceof Error ? error.message : String(error)}`)
  }
  const nextPath = isBundle ? join(rootResolved, target, 'SKILL.md') : join(rootResolved, `${target}.md`)
  try {
    const content = await readSkillFile(nextPath)
    await updateSkillFile(nextPath, rewriteFrontmatterName(content.raw, newName))
  } catch (error) {
    if (error instanceof SkillsError) throw error
    throw new SkillsError('fs-error', `cannot update frontmatter after renaming: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Rename a skill everywhere: the library canonical, the user root, and every
 *  recorded project root. The new name must be free in ALL locations
 *  (no-clobber); at least one location must hold the old name. */
export async function renameSkillEverywhere(name: string, newName: string, projectRoots: string[]): Promise<void> {
  assertSkillName(name)
  const target = assertSkillName(newName)
  const roots = [librarySkillsRoot(), userSkillsRoot(), ...projectRoots.map(projectSkillsRoot)]
  for (const root of roots) {
    if (await skillExistsInRoot(root, target)) {
      throw new SkillsError('conflict', `skill "${newName}" already exists in another location`, 409)
    }
  }
  let renamed = 0
  for (const root of roots) {
    if (await skillExistsInRoot(root, name)) {
      await renameSkillInRoot(root, name, newName)
      renamed += 1
    }
  }
  if (renamed === 0) {
    throw new SkillsError('not-found', `skill "${name}" not found`, 404)
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
