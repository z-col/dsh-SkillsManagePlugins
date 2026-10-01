import { spawn } from "node:child_process";
import { access, copyFile, cp, lstat, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parse } from "yaml";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { isSkillName } from "@deepseek-ai/dsh-skill";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
//#region src/trust-fence.ts
function header(headers, name) {
	const value = headers[name];
	return typeof value === "string" ? value : void 0;
}
/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return;
	}
}
/** Whether a normalized URL hostname names the local loopback authority. */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** Canonical authority form: hostname, or hostname:port when a port was written. */
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
/** Whether the request authority matches a trustedHosts entry (exact or port-less). */
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		const entryUrl = parseAuthority(entry);
		if (entryUrl === void 0) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host;
	});
}
/**
* Decide whether one skills request may reach the plugin routes.
* @param request - node HTTP request facts (headers).
* @param trustedHosts - non-loopback authorities this deployment serves.
* @returns true when the Host is ours (loopback or trusted) and browser markers are same-origin.
*/
function isTrustedApiRequest(request, trustedHosts) {
	const host = header(request.headers, "host");
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
	const origin = header(request.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
//#endregion
//#region src/wire.ts
/** One API failure with its wire code and HTTP status. */
var SkillsError = class extends Error {
	code;
	status;
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
};
/** Body size bound of one JSON request (defense against unbounded reads). */
const MAX_BODY_BYTES = 1 << 21;
/** Read and parse the JSON request body (bounded; malformed → bad-request). */
async function readJsonBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		total += buffer.length;
		if (total > MAX_BODY_BYTES) throw new SkillsError("bad-request", "request body too large");
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.trim() === "") return {};
	try {
		return JSON.parse(text);
	} catch {
		throw new SkillsError("bad-request", "request body is not valid JSON");
	}
}
/** Write a JSON response with the given status. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(payload);
}
/** Write the success envelope. */
function writeOk(res, value) {
	writeJson(res, 200, {
		ok: true,
		value
	});
}
/** Write the failure envelope for any thrown value (unknown → internal 500). */
function writeError(res, error) {
	if (error instanceof SkillsError) {
		writeJson(res, error.status, {
			ok: false,
			error: {
				code: error.code,
				message: error.message
			}
		});
		return;
	}
	writeJson(res, 500, {
		ok: false,
		error: {
			code: "internal",
			message: error instanceof Error ? error.message : String(error)
		}
	});
}
/** Narrow an unknown payload value to a string, else throw bad-request. */
function requireString(payload, key) {
	const value = payload?.[key];
	if (typeof value !== "string" || value === "") throw new SkillsError("bad-request", `missing or invalid "${key}"`);
	return value;
}
/** Narrow an unknown payload value to a string (empty allowed), else throw bad-request. */
function optionalString(payload, key) {
	const value = payload?.[key];
	if (value === void 0 || value === null) return "";
	if (typeof value !== "string") throw new SkillsError("bad-request", `invalid "${key}"`);
	return value;
}
//#endregion
//#region src/skill-fs.ts
/**
* Skill filesystem operations for dsh-skills-manager: resolve the user and
* project skill roots, scan a root for skill entries (directory bundles with
* SKILL.md or flat <name>.md files), parse SKILL.md frontmatter, and provide
* the CRUD primitives (create with no-clobber, atomic update, delete,
* rename). All paths are validated to stay inside the owning root.
*/
/** Resolve the user skill root: <$DSH_HOME>/skills. */
function userSkillsRoot() {
	return join(resolveDshHome(), "skills");
}
/**
* Find the project root for a cwd: walk up to the nearest ancestor holding a
* `.git` entry; when none exists, the cwd itself is the project root (the
* same rule as @deepseek-ai/dsh-skill-filesystem's findProjectRoot).
*/
async function findProjectRoot(cwd) {
	let current = resolve(cwd);
	for (;;) try {
		await access(join(current, ".git"));
		return current;
	} catch {
		const parent = dirname(current);
		if (parent === current) return resolve(cwd);
		current = parent;
	}
}
/** Resolve the project skill root: <projectRoot>/.dsh/skills. */
function projectSkillsRoot(projectRoot) {
	return join(resolve(projectRoot), ".dsh", "skills");
}
/** Assert a skill name follows the public kebab-case grammar. */
function assertSkillName(name) {
	if (!isSkillName(name)) throw new SkillsError("bad-request", `invalid skill name "${name}" (expected kebab-case)`);
	return name;
}
/**
* Scan one skill root for skill entries. Missing or unreadable roots return
* an empty list; the official provider treats them the same way.
*/
async function scanSkillsRoot(root) {
	let names;
	try {
		names = await readdir(root);
	} catch {
		return [];
	}
	const entries = [];
	for (const name of names.sort((a, b) => a.localeCompare(b))) {
		if (name === ".system") continue;
		const full = join(root, name);
		let stat;
		try {
			stat = await lstat(full);
		} catch {
			continue;
		}
		const path = stat.isDirectory() ? join(full, "SKILL.md") : stat.isFile() && name.endsWith(".md") ? full : void 0;
		if (path === void 0) continue;
		try {
			await access(path);
		} catch {
			continue;
		}
		const skillName = stat.isDirectory() ? name : name.slice(0, -3);
		if (!isSkillName(skillName)) continue;
		entries.push({
			name: skillName,
			path,
			directory: stat.isDirectory() ? full : root,
			form: stat.isDirectory() ? "bundle" : "flat",
			description: ""
		});
	}
	const valid = await Promise.all(entries.map(async (entry) => {
		try {
			const content = await readSkillFile(entry.path);
			entry.description = content.description;
			if (content.whenToUse !== void 0) entry.whenToUse = content.whenToUse;
			return true;
		} catch {
			return false;
		}
	}));
	return entries.filter((_, index) => valid[index]);
}
/**
* Read and parse one skill file (SKILL.md or <name>.md). The official
* provider requires frontmatter with `name` and `description`; a file
* without them is not a valid skill. Returns the parsed content or throws
* SkillsError not-found when the file is missing or malformed.
*/
async function readSkillFile(path) {
	let raw;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		throw new SkillsError("not-found", `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 404);
	}
	const parsed = parseSkillFrontmatter(raw);
	if (parsed === void 0) throw new SkillsError("bad-request", `"${path}" is not a valid skill file (missing YAML frontmatter with name and description)`);
	const name = stringField(parsed.data, "name");
	const description = stringField(parsed.data, "description");
	if (name === void 0 || !isSkillName(name) || description === void 0) throw new SkillsError("bad-request", `"${path}" frontmatter requires a kebab-case name and a description`);
	return {
		name,
		description,
		...optionalField(parsed.data, "whenToUse"),
		raw,
		body: parsed.body.trim()
	};
}
/** Serialize a skill file body with a complete frontmatter block. */
function serializeSkillFile(input) {
	assertSkillName(input.name);
	if (input.description === "") throw new SkillsError("bad-request", "skill description must not be empty");
	const data = {
		name: input.name,
		description: input.description
	};
	if (input.whenToUse !== void 0 && input.whenToUse !== "") data.whenToUse = input.whenToUse;
	const fm = `---\n${Object.entries(data).map(([k, v]) => `${k}: ${yamlQuote(v)}`).join("\n")}\n---\n`;
	const body = (input.body ?? "").trim();
	return fm + (body === "" ? "\n" : `${body}\n`);
}
/** Create a bundle skill (directory + SKILL.md) with no-clobber semantics. */
async function createBundleSkill(root, input) {
	const dir = join(resolve(root), assertSkillName(input.name));
	try {
		await mkdir(resolve(root), { recursive: true });
	} catch (error) {
		throw new SkillsError("fs-error", `cannot create skill root "${root}": ${error instanceof Error ? error.message : String(error)}`);
	}
	try {
		await mkdir(dir, { recursive: false });
	} catch (error) {
		if (error.code === "EEXIST") throw new SkillsError("conflict", `skill "${input.name}" already exists`, 409);
		throw new SkillsError("fs-error", `cannot create skill directory "${dir}": ${error instanceof Error ? error.message : String(error)}`);
	}
	const path = join(dir, "SKILL.md");
	try {
		await writeFileAtomic(path, serializeSkillFile(input), {
			mode: 420,
			dirMode: 493
		});
	} catch (error) {
		throw new SkillsError("fs-error", `cannot write "${path}": ${error instanceof Error ? error.message : String(error)}`);
	}
	return {
		name: input.name,
		path,
		directory: dir,
		form: "bundle",
		description: input.description
	};
}
/** Replace the full content of a skill file atomically. */
async function updateSkillFile(path, raw) {
	const parsed = parseSkillFrontmatter(raw);
	if (parsed === void 0) throw new SkillsError("bad-request", "content must keep the YAML frontmatter with name and description");
	const name = stringField(parsed.data, "name");
	if (name === void 0 || !isSkillName(name)) throw new SkillsError("bad-request", "frontmatter name must be a valid kebab-case skill name");
	if (stringField(parsed.data, "description") === void 0) throw new SkillsError("bad-request", "frontmatter description is required");
	try {
		await writeFileAtomic(path, raw.endsWith("\n") ? raw : `${raw}\n`, { mode: 420 });
	} catch (error) {
		throw new SkillsError("fs-error", `cannot write "${path}": ${error instanceof Error ? error.message : String(error)}`);
	}
}
/** The canonical skill-library root: <$DSH_HOME>/skill-library. */
function librarySkillsRoot() {
	return join(resolveDshHome(), "skill-library");
}
/** The skills-manager state index: <$DSH_HOME>/skills-manager/index.json. */
function skillsIndexPath() {
	return join(resolveDshHome(), "skills-manager", "index.json");
}
/** Read the recorded project roots from the index (missing/corrupt → []). */
async function readProjectIndex() {
	try {
		const raw = await readFile(skillsIndexPath(), "utf8");
		const parsed = JSON.parse(raw);
		if (parsed === null || !Array.isArray(parsed.projects)) return [];
		return parsed.projects.filter((entry) => typeof entry === "string" && entry.length > 0).map((entry) => resolve(entry));
	} catch {
		return [];
	}
}
/** Record a project root into the index (idempotent; atomic write). */
async function recordProjectRoot(root) {
	const projects = await readProjectIndex();
	const canonical = resolve(root);
	if (projects.some((project) => project === canonical)) return;
	projects.push(canonical);
	projects.sort((a, b) => a.localeCompare(b));
	const indexPath = skillsIndexPath();
	await mkdir(dirname(indexPath), { recursive: true });
	await writeFileAtomic(indexPath, JSON.stringify({
		version: 1,
		projects
	}, null, 2) + "\n", { mode: 420 });
}
/** Whether a skill name exists in a root (bundle directory or flat file). */
async function skillExistsInRoot(root, name) {
	const skillName = assertSkillName(name);
	for (const candidate of [join(root, skillName), join(root, `${skillName}.md`)]) try {
		await access(candidate);
		return true;
	} catch {}
	return false;
}
/** Remove a skill name from a root (bundle directory or flat file). Throws
*  not-found when neither form is present. */
async function removeSkillNameFromRoot(root, name) {
	const skillName = assertSkillName(name);
	let removed = false;
	try {
		await rm(join(root, skillName), {
			recursive: true,
			force: false
		});
		removed = true;
	} catch {}
	if (!removed) try {
		await rm(join(root, `${skillName}.md`), { force: false });
		removed = true;
	} catch {}
	if (!removed) throw new SkillsError("not-found", `skill "${name}" is not present in this root`, 404);
}
/** Copy a skill entry into a destination root, preserving its form. With
*  `overwrite` an existing copy is replaced (the stale opposite form is
*  removed first); otherwise the target must be free (no-clobber → conflict).
*  The destination root chain is created on demand. */
async function copySkillEntryToRoot(entry, destRoot, options = {}) {
	const root = resolve(destRoot);
	const name = assertSkillName(entry.name);
	if (await skillExistsInRoot(root, name)) {
		if (options.overwrite !== true) throw new SkillsError("conflict", `skill "${name}" already exists in the destination root`, 409);
		await removeSkillNameFromRoot(root, name);
	}
	await mkdir(root, { recursive: true });
	const target = entry.form === "bundle" ? join(root, name) : join(root, `${name}.md`);
	try {
		if (entry.form === "bundle") await cp(entry.directory, target, { recursive: true });
		else await copyFile(entry.path, target);
	} catch (error) {
		throw new SkillsError("fs-error", `cannot copy skill "${name}": ${error instanceof Error ? error.message : String(error)}`);
	}
	return {
		name,
		path: entry.form === "bundle" ? join(target, "SKILL.md") : target,
		directory: entry.form === "bundle" ? target : root,
		form: entry.form,
		description: entry.description ?? ""
	};
}
/** Import one skill entry into the canonical library, normalized to bundle
*  form (so the library never holds two entries with the same name). */
async function importSkillToLibrary(entry) {
	const lib = librarySkillsRoot();
	const targetDir = join(lib, assertSkillName(entry.name));
	await mkdir(lib, { recursive: true });
	try {
		if (entry.form === "bundle") await cp(entry.directory, targetDir, { recursive: true });
		else {
			await mkdir(targetDir, { recursive: false });
			await writeFileAtomic(join(targetDir, "SKILL.md"), await readFile(entry.path, "utf8"), { mode: 420 });
		}
	} catch (error) {
		if (error.code === "EEXIST") return;
		throw new SkillsError("fs-error", `cannot import skill "${entry.name}" into the library: ${error instanceof Error ? error.message : String(error)}`);
	}
}
/** Reconcile the library with the user root and every recorded project root:
*  skills present in those roots but missing from the library are copied in
*  (canonicalized as bundle form). Idempotent; missing roots are skipped. */
async function reconcileLibrary(projectRoots) {
	const lib = librarySkillsRoot();
	await mkdir(lib, { recursive: true });
	const seen = /* @__PURE__ */ new Set();
	for (const entry of await scanSkillsRoot(lib)) seen.add(entry.name);
	const roots = [userSkillsRoot(), ...projectRoots.map(projectSkillsRoot)];
	for (const root of roots) {
		let entries;
		try {
			entries = await scanSkillsRoot(root);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (seen.has(entry.name)) continue;
			try {
				await importSkillToLibrary(entry);
				seen.add(entry.name);
			} catch {}
		}
	}
}
/** The assignment targets of a canonical skill: 'user' and/or 'project:<root>'
*  for every root where a copy currently exists. */
async function assignmentTargetsOf(entry, projectRoots) {
	const targets = [];
	if (await skillExistsInRoot(userSkillsRoot(), entry.name)) targets.push("user");
	for (const projectRootPath of projectRoots) if (await skillExistsInRoot(projectSkillsRoot(projectRootPath), entry.name)) targets.push(`project:${projectRootPath}`);
	return targets;
}
/** Push the canonical library copy to every root where the skill is assigned
*  (overwrite). Returns the refreshed targets. */
async function syncSkillEntry(entry, projectRoots) {
	const targets = await assignmentTargetsOf(entry, projectRoots);
	for (const target of targets) await copySkillEntryToRoot(entry, target === "user" ? userSkillsRoot() : projectSkillsRoot(target.slice(8)), { overwrite: true });
	return targets;
}
/** Recycle a skill from one level root (user or project): remove the copy,
*  keep the library canonical. */
async function recycleSkillFromRoot(name, destRoot) {
	await removeSkillNameFromRoot(resolve(destRoot), assertSkillName(name));
}
/** Delete a skill everywhere: the library canonical, the user root, and every
*  recorded project root. Throws not-found when the skill is nowhere. */
async function deleteSkillEverywhere(name, projectRoots) {
	const skillName = assertSkillName(name);
	const roots = [
		librarySkillsRoot(),
		userSkillsRoot(),
		...projectRoots.map(projectSkillsRoot)
	];
	let removed = 0;
	for (const root of roots) if (await skillExistsInRoot(root, skillName)) {
		await removeSkillNameFromRoot(root, skillName);
		removed += 1;
	}
	if (removed === 0) throw new SkillsError("not-found", `skill "${name}" not found`, 404);
}
/** Rename a skill in a single root (bundle directory or flat file), rewriting
*  the frontmatter name (no-clobber on the target in this root). */
async function renameSkillInRoot(root, name, newName) {
	const rootResolved = resolve(root);
	const target = assertSkillName(newName);
	if (await skillExistsInRoot(rootResolved, target)) throw new SkillsError("conflict", `skill "${newName}" already exists`, 409);
	const sourceDir = join(rootResolved, name);
	const sourceFile = join(rootResolved, `${name}.md`);
	let sourcePath;
	let isBundle;
	try {
		await access(sourceDir);
		sourcePath = sourceDir;
		isBundle = true;
	} catch {
		try {
			await access(sourceFile);
			sourcePath = sourceFile;
			isBundle = false;
		} catch {
			throw new SkillsError("not-found", `skill "${name}" not found in this root`, 404);
		}
	}
	try {
		await rename(sourcePath, isBundle ? join(rootResolved, target) : join(rootResolved, `${target}.md`));
	} catch (error) {
		throw new SkillsError("fs-error", `cannot rename "${name}" to "${newName}": ${error instanceof Error ? error.message : String(error)}`);
	}
	const nextPath = isBundle ? join(rootResolved, target, "SKILL.md") : join(rootResolved, `${target}.md`);
	try {
		await updateSkillFile(nextPath, rewriteFrontmatterName((await readSkillFile(nextPath)).raw, newName));
	} catch (error) {
		if (error instanceof SkillsError) throw error;
		throw new SkillsError("fs-error", `cannot update frontmatter after renaming: ${error instanceof Error ? error.message : String(error)}`);
	}
}
/** Rename a skill everywhere: the library canonical, the user root, and every
*  recorded project root. The new name must be free in ALL locations
*  (no-clobber); at least one location must hold the old name. */
async function renameSkillEverywhere(name, newName, projectRoots) {
	assertSkillName(name);
	const target = assertSkillName(newName);
	const roots = [
		librarySkillsRoot(),
		userSkillsRoot(),
		...projectRoots.map(projectSkillsRoot)
	];
	for (const root of roots) if (await skillExistsInRoot(root, target)) throw new SkillsError("conflict", `skill "${newName}" already exists in another location`, 409);
	let renamed = 0;
	for (const root of roots) if (await skillExistsInRoot(root, name)) {
		await renameSkillInRoot(root, name, newName);
		renamed += 1;
	}
	if (renamed === 0) throw new SkillsError("not-found", `skill "${name}" not found`, 404);
}
/** Replace the `name:` line inside the leading frontmatter block. */
function rewriteFrontmatterName(raw, newName) {
	const firstLineEnd = raw.indexOf("\n");
	if (firstLineEnd < 0) return raw;
	if (raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") return raw;
	const closing = findClosingFrontmatter(raw, firstLineEnd + 1);
	if (closing === void 0) return raw;
	const head = raw.slice(0, closing.bodyStart);
	const tail = raw.slice(closing.bodyStart);
	return head.split("\n").map((line) => {
		if (/^name\s*:/.test(line)) return `name: ${newName}`;
		return line;
	}).join("\n") + tail;
}
/** Parse leading `---` YAML frontmatter; undefined when absent or malformed. */
function parseSkillFrontmatter(raw) {
	const firstLineEnd = raw.indexOf("\n");
	if (firstLineEnd < 0) return void 0;
	if (raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") return void 0;
	const start = firstLineEnd + 1;
	const closing = findClosingFrontmatter(raw, start);
	if (closing === void 0) return void 0;
	let data;
	try {
		data = parse(raw.slice(start, closing.start));
	} catch {
		return;
	}
	if (typeof data !== "object" || data === null || Array.isArray(data)) return void 0;
	return {
		data,
		body: raw.slice(closing.bodyStart)
	};
}
function findClosingFrontmatter(raw, start) {
	let lineStart = start;
	while (lineStart <= raw.length) {
		const nextNewline = raw.indexOf("\n", lineStart);
		const lineEnd = nextNewline < 0 ? raw.length : nextNewline;
		if (raw.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") return {
			start: lineStart,
			bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1
		};
		if (nextNewline < 0) return void 0;
		lineStart = nextNewline + 1;
	}
}
function stringField(data, key) {
	const value = data[key];
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function optionalField(data, key) {
	const value = stringField(data, key);
	return value === void 0 ? {} : { [key]: value };
}
/** Quote a frontmatter scalar for YAML single-line safety. */
function yamlQuote(value) {
	if (/^[A-Za-z0-9_\-./ ]+$/.test(value) && !value.startsWith("-") && !value.startsWith("!")) return value;
	return JSON.stringify(value);
}
//#endregion
//#region src/index.ts
/**
* dsh-skills-manager host half: the /skills JSON API that powers the web
* management panel. Routes are fenced by the same browser-trust rule as the
* /api gateway (Host-header loopback or the connection row's trustedHosts),
* and every filesystem operation stays inside a known skill root.
*
* The API is conversation-scoped: requests carry a sessionId, and the
* session's authoritative cwd (from the session store header) selects the
* project root; the caller's own cwd is the fallback while the session is
* still hydrating, and the process cwd is the last resort.
*
* Skill model (three levels):
* - Skill library (<$DSH_HOME>/skill-library) — the canonical home of every
*   skill; the only place new skills are created.
* - User level (~/.dsh/skills) — a copy = "assigned to the user level"
*   (global availability).
* - Project level (<project>/.dsh/skills) — a copy = "assigned to that
*   project". A skill can be assigned to the user level AND any number of
*   projects at once; the project copy shadows the user copy inside that
*   project (DSH's rank resolution prefers the lower project rank).
*/
/** Plugin identity for cordis.yml rows. */
const name = "dsh-skills-manager";
/** Services required before mounting: the webserver routes, the session store, and the loader's connection row. */
const inject = [
	"webServer",
	"sessions",
	"loader"
];
/** The connection row's resolved trustedHosts (live read; the /api fence's own list). */
function trustedHostsOf(ctx) {
	for (const entry of ctx.loader.entries()) if (entry.options.name === "connection") return entry.options.config?.trustedHosts ?? [];
	return [];
}
/** Open a directory in the OS file manager (best-effort). The directory is
*  created first so opening a not-yet-existing project root still works.
*  `DSH_SKILLS_NO_OPEN=1` skips the actual spawn — a test escape hatch so
*  integration tests never pop open a real file manager window. */
async function openFolderInFileManager(path) {
	await mkdir(path, { recursive: true });
	if (process.env.DSH_SKILLS_NO_OPEN === "1") return;
	const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
	const child = spawn(command, [path], {
		detached: true,
		stdio: "ignore"
	});
	child.on("error", () => {});
	child.unref();
}
/** Resolve a session's authoritative working directory (never throws). */
function sessionCwdOf(ctx, sessionId, clientCwd) {
	const headerCwd = ctx.sessions.get(sessionId)?.header.cwd;
	if (headerCwd !== void 0 && headerCwd !== "") return headerCwd;
	if (clientCwd !== void 0 && clientCwd !== "" && isAbsolute(clientCwd)) return clientCwd;
	return process.cwd();
}
/** Resolve the user skill root (validated absolute). */
function userRoot() {
	return resolve(userSkillsRoot());
}
/** Resolve the canonical library root (validated absolute). */
function libraryRoot() {
	return resolve(librarySkillsRoot());
}
/** Resolve the project skill root for a cwd (finds the git/project root first). */
async function projectRoot(cwd) {
	const root = await findProjectRoot(cwd);
	return resolve(projectSkillsRoot(root));
}
/** Read `root` from a payload: 'user' | 'project' | 'library'. */
function requireAnyRoot(payload, key = "root") {
	const value = requireString(payload, key);
	if (value !== "user" && value !== "project" && value !== "library") throw new SkillsError("bad-request", `${key} must be "user", "project", or "library"`);
	return value;
}
/** Resolve the root path for a kind + cwd. */
async function rootPathOf(kind, cwd) {
	if (kind === "library") return libraryRoot();
	return kind === "user" ? userRoot() : projectRoot(cwd);
}
/** Build the request scope from the payload (sessionId + root + optional cwd). */
async function scopeOf(ctx, payload) {
	const sessionId = requireString(payload, "sessionId");
	const kind = requireAnyRoot(payload);
	const cwd = sessionCwdOf(ctx, sessionId, optionalString(payload, "cwd"));
	return {
		kind,
		root: await rootPathOf(kind, cwd),
		cwd
	};
}
/** Resolve the session's project root and ensure it is recorded in the index
*  (session-aware project discovery for the library view). */
async function sessionProject(ctx, payload) {
	const cwd = sessionCwdOf(ctx, requireString(payload, "sessionId"), optionalString(payload, "cwd"));
	const project = await findProjectRoot(cwd);
	await recordProjectRoot(project);
	return {
		cwd,
		project
	};
}
/** Resolve an assign/recycle target: 'user' or { project: <indexed root> }. */
async function resolveAssignTarget(value) {
	if (value === "user") return userRoot();
	if (typeof value === "object" && value !== null && typeof value.project === "string") {
		const projectRootPath = resolve(value.project);
		if (!(await readProjectIndex()).some((project) => project === projectRootPath)) throw new SkillsError("bad-request", `project root "${projectRootPath}" is not indexed`);
		return projectSkillsRoot(projectRootPath);
	}
	throw new SkillsError("bad-request", "target must be \"user\" or { project }");
}
/** Find an existing entry by name in a scanned root (throws not-found). */
async function findEntry(scope, name) {
	const entry = (await scanSkillsRoot(scope.root)).find((candidate) => candidate.name === name);
	if (entry === void 0) throw new SkillsError("not-found", `skill "${name}" not found in ${scope.kind} root`, 404);
	return entry;
}
/** The complete /skills API surface. */
function api(ctx) {
	return {
		/** Resolve both roots + project display info for the panel header. */
		async "roots.info"(payload) {
			const cwd = sessionCwdOf(ctx, requireString(payload, "sessionId"), optionalString(payload, "cwd"));
			return {
				userRoot: userRoot(),
				projectRoot: await projectRoot(cwd),
				cwd
			};
		},
		/** List skills in one level root (user or project; the library has its
		*  own method because it carries assignment metadata). */
		async "skills.list"(payload) {
			const scope = await scopeOf(ctx, payload);
			if (scope.kind === "library") throw new SkillsError("bad-request", "use skills.library.list for the library");
			return (await scanSkillsRoot(scope.root)).map((entry) => ({
				name: entry.name,
				form: entry.form,
				description: entry.description,
				...entry.whenToUse !== void 0 ? { whenToUse: entry.whenToUse } : {},
				path: entry.path
			}));
		},
		/** Read the full content of one skill (raw SKILL.md + parsed fields). The
		*  root may be the library canonical or a level copy. */
		async "skills.get"(payload) {
			const entry = await findEntry(await scopeOf(ctx, payload), requireString(payload, "name"));
			return {
				...await readSkillFile(entry.path),
				path: entry.path,
				form: entry.form
			};
		},
		/** Create a new skill: the canonical bundle goes into the library, with
		*  optional immediate assignment (`assignTo: ['user' | 'project']`).
		*  No-clobber across the canonical and every target BEFORE creating, so a
		*  conflict never leaves an orphan canonical. */
		async "skills.create"(payload) {
			const { cwd } = await sessionProject(ctx, payload);
			const name = requireString(payload, "name");
			const description = requireString(payload, "description");
			const whenToUse = optionalString(payload, "whenToUse");
			const body = optionalString(payload, "body");
			const assignToValue = payload?.assignTo;
			const assignTo = [];
			if (assignToValue !== void 0) {
				if (!Array.isArray(assignToValue)) throw new SkillsError("bad-request", "assignTo must be an array of \"user\" | \"project\"");
				for (const value of assignToValue) {
					if (value !== "user" && value !== "project") throw new SkillsError("bad-request", "assignTo entries must be \"user\" or \"project\"");
					assignTo.push(value);
				}
			}
			const lib = libraryRoot();
			const user = userRoot();
			const project = await projectRoot(cwd);
			if (await skillExistsInRoot(lib, name)) throw new SkillsError("conflict", `skill "${name}" already exists`, 409);
			for (const target of assignTo) if (await skillExistsInRoot(target === "user" ? user : project, name)) throw new SkillsError("conflict", `skill "${name}" already exists in the ${target} level`, 409);
			const entry = await createBundleSkill(lib, {
				name,
				description,
				...whenToUse !== "" ? { whenToUse } : {},
				body
			});
			for (const target of assignTo) await copySkillEntryToRoot(entry, target === "user" ? user : project);
			return {
				name: entry.name,
				path: entry.path
			};
		},
		/** Replace the full content of a skill file atomically. Writing a level
		*  copy also refreshes the library canonical, so the skill keeps one
		*  source of truth; other copies are refreshed via the manual 同步 action. */
		async "skills.update"(payload) {
			const scope = await scopeOf(ctx, payload);
			const name = requireString(payload, "name");
			const raw = requireString(payload, "content");
			const entry = await findEntry(scope, name);
			await updateSkillFile(entry.path, raw);
			if (scope.kind !== "library") {
				const canonical = (await scanSkillsRoot(libraryRoot())).find((candidate) => candidate.name === name);
				if (canonical !== void 0 && canonical.path !== entry.path) await updateSkillFile(canonical.path, raw);
			}
			return { ok: true };
		},
		/** Rename a skill everywhere (library canonical + all level copies),
		*  no-clobber on the new name across every location. */
		async "skills.rename"(payload) {
			const { project } = await sessionProject(ctx, payload);
			const name = requireString(payload, "name");
			const newName = requireString(payload, "newName");
			await renameSkillEverywhere(name, newName, await readProjectIndex());
			return { name: newName };
		},
		/** Delete a skill everywhere (library canonical + all level copies). */
		async "skills.delete"(payload) {
			const { project } = await sessionProject(ctx, payload);
			await deleteSkillEverywhere(requireString(payload, "name"), await readProjectIndex());
			return { ok: true };
		},
		/** Recycle a skill from ONE level (user or project): remove that copy,
		*  keep the library canonical and every other assignment. */
		async "skills.recycle"(payload) {
			const scope = await scopeOf(ctx, payload);
			if (scope.kind === "library") throw new SkillsError("bad-request", "use skills.library.recycle for the library");
			await recycleSkillFromRoot(requireString(payload, "name"), scope.root);
			return { ok: true };
		},
		/** List the library: every canonical skill with its assignment badges,
		*  the indexed projects, and the current session's project root. Runs
		*  session-aware project discovery + library reconciliation (existing
		*  user/project skills are imported into the library on first sight). */
		async "skills.library.list"(payload) {
			const { cwd, project } = await sessionProject(ctx, payload);
			const projects = await readProjectIndex();
			await reconcileLibrary(projects);
			const entries = await scanSkillsRoot(libraryRoot());
			return {
				skills: await Promise.all(entries.map(async (entry) => ({
					name: entry.name,
					form: entry.form,
					description: entry.description,
					...entry.whenToUse !== void 0 ? { whenToUse: entry.whenToUse } : {},
					assignments: await assignmentTargetsOf(entry, projects)
				}))),
				projects: projects.map((root) => ({
					root,
					label: basename(root) || root
				})),
				currentProject: project
			};
		},
		/** 移至 a level (user/global or an indexed project): copy the canonical
		*  there, overwriting an existing copy so the call is idempotent — the
		*  library original always wins (doubles as a refresh). */
		async "skills.library.assign"(payload) {
			const { cwd } = await sessionProject(ctx, payload);
			const name = requireString(payload, "name");
			const toValue = payload?.to;
			const destRoot = await resolveAssignTarget(toValue);
			const canonical = (await scanSkillsRoot(libraryRoot())).find((entry) => entry.name === name);
			if (canonical === void 0) throw new SkillsError("not-found", `skill "${name}" not found in the library`, 404);
			const copied = await copySkillEntryToRoot(canonical, destRoot, { overwrite: true });
			return {
				name: copied.name,
				path: copied.path
			};
		},
		/** Recycle a library skill from one assignment target ('user' or an
		*  indexed project), keeping the canonical and other assignments. */
		async "skills.library.recycle"(payload) {
			const { cwd } = await sessionProject(ctx, payload);
			const name = requireString(payload, "name");
			const fromValue = payload?.from;
			await recycleSkillFromRoot(name, await resolveAssignTarget(fromValue));
			return { ok: true };
		},
		/** Sync a library skill's canonical to every assigned copy (overwrite). */
		async "skills.library.sync"(payload) {
			const { project } = await sessionProject(ctx, payload);
			const name = requireString(payload, "name");
			const projects = await readProjectIndex();
			const canonical = (await scanSkillsRoot(libraryRoot())).find((entry) => entry.name === name);
			if (canonical === void 0) throw new SkillsError("not-found", `skill "${name}" not found in the library`, 404);
			return {
				ok: true,
				targets: await syncSkillEntry(canonical, projects)
			};
		},
		/** Open the selected level's folder in the OS file manager (library /
		*  global / project). The path is resolved server-side from the root
		*  kind — the API never opens an arbitrary client-supplied path. */
		async "skills.openFolder"(payload) {
			const scope = await scopeOf(ctx, payload);
			await openFolderInFileManager(scope.root);
			return {
				ok: true,
				path: scope.root
			};
		}
	};
}
/**
* Plugin body: mount the fenced /skills API routes.
* @param ctx - the host cordis context.
*/
function apply(ctx) {
	const trustedHosts = trustedHostsOf(ctx);
	const fence = (req) => isTrustedApiRequest(req, trustedHosts);
	const methods = api(ctx);
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/skills",
		handler: async (req, res) => {
			if (!fence(req)) {
				res.writeHead(403);
				res.end("forbidden");
				return;
			}
			if (req.method !== "POST") {
				res.writeHead(405);
				res.end();
				return;
			}
			const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
			const method = /^\/skills\/api\/([A-Za-z0-9.]+)$/.exec(pathname)?.[1];
			if (method === void 0) {
				writeError(res, new SkillsError("not-found", "unknown skills API path", 404));
				return;
			}
			const handler = methods[method];
			if (handler === void 0) {
				writeError(res, new SkillsError("not-found", `unknown skills API method "${method}"`, 404));
				return;
			}
			try {
				writeOk(res, await handler(await readJsonBody(req)));
			} catch (error) {
				writeError(res, error);
			}
		}
	}), "dsh-skills-manager: /skills API routes");
}
//#endregion
export { SkillsError, apply, copySkillEntryToRoot, deleteSkillEverywhere, inject, isLoopbackHostname, isTrustedApiRequest, librarySkillsRoot, name, readProjectIndex, reconcileLibrary, recordProjectRoot, recycleSkillFromRoot, renameSkillEverywhere, skillExistsInRoot, syncSkillEntry };
