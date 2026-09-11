// Superpowers for DeepSeek Harness (dsh) — in-process bundle plugin.
//
// This package is the dsh adapter and nothing else: the skill content it serves
// is fetched from the original author's repository as an ordinary npm
// dependency (`"superpowers": "github:obra/superpowers#v6.3.0"`), so this repo
// ships no copy of upstream's work. See `references/CREDITS.md` and README.
//
// Two contributions, both riding the harness's own surfaces:
//
//   1. `ctx.skills.registerProvider(...)` — the upstream `skills/` directory
//      (14 skills) becomes a dsh skill catalog, so the model sees them in the
//      `skill` catalog and loads bodies with dsh's native `skill` tool. Skill
//      directories are handed back as `resourceBase`, so the scripts, prompts and
//      references a skill names resolve against its real base directory.
//
//   2. `ctx.systemPrompt.section(...)` — the `using-superpowers` bootstrap
//      (frontmatter stripped, wrapped in <EXTREMELY_IMPORTANT>, with the dsh tool
//      mapping appended) is contributed as an always-on system-prompt section.
//      dsh has no session-start hook channel, and its system-prompt registry is
//      the sanctioned always-on contribution point: a section is assembled into
//      every request from the first turn, so no per-session opt-in is required
//      (the port requirement), while — unlike a user-role message re-emitted each
//      turn — it stays a stable prompt prefix instead of growing the transcript.
//
// The plugin imports no packages: dsh services arrive through `inject`, and
// everything else is a Node builtin, so the same file works when the package is
// installed with `link:`, `file:`, from a Git URL, or from a registry, under
// npm's flat and pnpm's strict layouts alike.
//
// Skills-directory resolution order (first candidate that looks like a
// Superpowers skills root — it must contain `using-superpowers/SKILL.md` wins):
//
//   1. `config.skillsDir` (explicit)
//   2. `SUPERPOWERS_SKILLS_DIR` env var
//   3. `./skills` inside this package — an adapter that vendors the skills next
//      to its entry point
//   4. `../skills` beside this package — the in-repo layout, where this adapter
//      is checked out as `<superpowers>/.dsh-plugin/`
//   5. the `skills/` directory of the dependency `superpowers` (the normal
//      standalone path: the original author's repository, installed by npm/pnpm)
//
// If none resolve, the plugin degrades: it logs a warning, registers no skill
// provider, and contributes no bootstrap. It never fails the profile boot.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Directory holding this plugin module. */
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))

/** Cordis plugin name. */
export const name = 'superpowers'

/** dsh services this plugin registers against. */
export const inject = ['skills', 'systemPrompt']

/** Skill-provider name, unique within the calling context's layer. */
const PROVIDER_NAME = 'superpowers'
/** Prompt-visible origin bucket for catalog warnings. */
const SKILL_SOURCE = 'superpowers'
/**
 * Packaged-provider precedence rank, matching `BUNDLED_SKILL_RANK` in
 * `@deepseek-ai/dsh-skill`. Lower ranks win a duplicate name, so a project
 * (`100`/`200`) or user (`400`/`500`) skill of the same name still shadows the
 * one shipped here — which is the right precedence for a user's own skills.
 */
const SKILL_RANK = 600
/** Skill body filename inside a skill directory. */
const SKILL_FILE = 'SKILL.md'
/** The bootstrap skill whose body is injected every session. */
const BOOTSTRAP_SKILL = 'using-superpowers'
/** Module name of the upstream package, resolved when it is a dependency. */
const UPSTREAM_PACKAGE = 'superpowers'
/** Rendered at the top of the injected bootstrap, for tests and diagnostics. */
const BOOTSTRAP_MARKER = 'superpowers:using-superpowers bootstrap for dsh'
/** Prompt section name; unique per scope, so a second mount throws loudly. */
const BOOTSTRAP_SECTION = 'superpowers:bootstrap'
/**
 * Default section order. dsh's convention: `-100` harness identity, `0` the
 * deployment persona, `100`–`199` tool and behavior guidance. `121` sits in that
 * band after the tool-specific sections and before the coarse `150` blocks.
 */
const DEFAULT_BOOTSTRAP_ORDER = 121
/** dsh's public skill-name grammar (`@deepseek-ai/dsh-skill` `isSkillName`). */
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** Long-form tool mapping, relative to the bootstrap skill directory. */
const TOOL_MAPPING_REFERENCE = join('references', 'dsh-tools.md')

/**
 * Register the Superpowers skill catalog and bootstrap on dsh.
 *
 * @param ctx - cordis context carrying the injected `skills` and `systemPrompt` services.
 * @param config - optional plugin config; every key has an in-code default, so a
 *   composition may mount the plugin with no config at all.
 */
export function apply(ctx, config = {}) {
  const logger = createLogger(ctx)
  const skillsDir = resolveSkillsDir(config)
  const settings = normalizeConfig(config)

  if (skillsDir === undefined) {
    logger.warn(
      'skills directory not found — no Superpowers skills registered. Set the plugin '
      + '`skillsDir` config or the SUPERPOWERS_SKILLS_DIR environment variable to the '
      + 'repository\'s skills/ directory.',
    )
  } else if (settings.skills) {
    ctx.skills.registerProvider((control) => createProvider({ skillsDir, logger, control }))
    logger.info(`registered the Superpowers skill catalog from ${skillsDir}`)
  }

  if (settings.bootstrap) {
    const bootstrap = createBootstrap({ skillsDir, toolMapping: settings.toolMapping, logger })
    ctx.systemPrompt.section({
      name: BOOTSTRAP_SECTION,
      order: settings.order,
      text: () => bootstrap(),
    })
  }
}

/**
 * Normalize the plugin config, keeping every default in one place so the
 * `cordis.patch.yml` row and a profile-level override stay readable.
 *
 * @param config - raw plugin config from the composition.
 * @returns resolved settings.
 */
function normalizeConfig(config) {
  return {
    skills: config.skills ?? true,
    bootstrap: config.bootstrap ?? true,
    toolMapping: config.toolMapping ?? true,
    order: Number.isFinite(config.order) ? config.order : DEFAULT_BOOTSTRAP_ORDER,
  }
}

/**
 * Build a logger that cannot break activation if the logger service is missing.
 *
 * @param ctx - cordis context.
 * @returns an object with `info`, `warn` and `error`.
 */
function createLogger(ctx) {
  try {
    if (typeof ctx?.logger === 'function') return ctx.logger(name)
  } catch { /* sparse composition: fall through to the console logger */ }
  const prefix = `[${name}]`
  return {
    info() {},
    warn(message) { console.warn(`${prefix} ${message}`) },
    error(message) { console.error(`${prefix} ${message}`) },
  }
}

// ---- skills directory resolution ----------------------------------------

/**
 * Resolve the Superpowers skills root.
 *
 * @param config - raw plugin config (reads `skillsDir`).
 * @returns the absolute skills directory, or `undefined` when none resolves.
 */
function resolveSkillsDir(config) {
  const candidates = []
  const configured = typeof config.skillsDir === 'string' ? config.skillsDir.trim() : ''
  if (configured !== '') candidates.push(isAbsolute(configured) ? configured : resolve(configured))
  const fromEnv = (process.env.SUPERPOWERS_SKILLS_DIR ?? '').trim()
  if (fromEnv !== '') candidates.push(isAbsolute(fromEnv) ? fromEnv : resolve(fromEnv))
  candidates.push(join(PLUGIN_DIR, 'skills'))
  candidates.push(resolve(PLUGIN_DIR, '..', 'skills'))
  const dependency = resolveDependencySkillsDir()
  if (dependency !== undefined) candidates.push(dependency)
  return candidates.find((candidate) => looksLikeSkillsDir(candidate))
}

/**
 * Return whether a directory is a Superpowers skills root: it holds the
 * `using-superpowers/SKILL.md` bootstrap every Superpowers layout ships.
 *
 * @param dir - candidate directory.
 * @returns whether the directory looks like the skills root.
 */
function looksLikeSkillsDir(dir) {
  try {
    return statSync(dir).isDirectory() && existsSync(join(dir, BOOTSTRAP_SKILL, SKILL_FILE))
  } catch {
    return false
  }
}

/**
 * Resolve `skills/` from a `superpowers` package installed as a dependency, so a
 * standalone adapter can consume the original author's package instead of
 * vendoring a copy. The package does not export `./package.json` in every
 * layout, so this resolves the main entry and walks up to the package root.
 *
 * @returns the absolute skills directory, or `undefined`.
 */
function resolveDependencySkillsDir() {
  // Prefer the shallow `node_modules/<name>/skills` path when one exists: it is
  // the friendly path the model will read, whereas a package manager's module
  // resolution reports the real path inside its virtual store
  // (`node_modules/.pnpm/<hash>/node_modules/<name>`).
  for (const ancestor of ancestorDirs(PLUGIN_DIR)) {
    const shallow = join(ancestor, 'node_modules', UPSTREAM_PACKAGE, 'skills')
    if (looksLikeSkillsDir(shallow)) return shallow
  }
  let require
  try {
    require = createRequire(import.meta.url)
  } catch {
    return undefined
  }
  const roots = []
  for (const specifier of [`${UPSTREAM_PACKAGE}/package.json`, UPSTREAM_PACKAGE]) {
    try {
      roots.push(require.resolve(specifier))
    } catch { /* try the next specifier */ }
  }
  for (const entry of roots) {
    let dir = dirname(entry)
    for (let depth = 0; depth < 12; depth += 1) {
      const manifest = join(dir, 'package.json')
      if (existsSync(manifest)) {
        try {
          const meta = JSON.parse(readFileSync(manifest, 'utf8'))
          if (meta?.name === UPSTREAM_PACKAGE) {
            const skills = join(dir, 'skills')
            if (looksLikeSkillsDir(skills)) return skills
            break
          }
        } catch { /* unreadable manifest: keep walking up */ }
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return undefined
}

/**
 * Walk a directory and each of its ancestors.
 *
 * @param start - absolute directory.
 * @returns the ancestry, nearest first.
 */
function ancestorDirs(start) {
  const dirs = []
  let dir = start
  for (let depth = 0; depth < 12; depth += 1) {
    dirs.push(dir)
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dirs
}

/**
 * Read a text file synchronously — used only on the rare path-resolution and
 * bootstrap-assembly paths, never per model step.
 *
 * @param file - absolute path.
 * @returns file content.
 */
function readText(file) {
  return readFileSync(file, 'utf8')
}

// ---- skill provider ------------------------------------------------------

/**
 * Create the Superpowers skill provider.
 *
 * @param options - provider inputs.
 * @param options.skillsDir - absolute skills root.
 * @param options.logger - plugin logger.
 * @param options.control - registration-scoped provider control from the registry.
 * @returns a `SkillProvider` that discovers one `SKILL.md` per skill directory.
 */
function createProvider({ skillsDir, logger, control }) {
  /** Absolute SKILL.md path → frontmatter parsed from the file at that revision. */
  const cache = new Map()
  return {
    name: PROVIDER_NAME,
    async list(options) {
      throwIfAborted(control?.signal ?? options?.signal)
      let entries
      try {
        entries = await readdir(skillsDir, { withFileTypes: true })
      } catch (error) {
        logger.warn(`cannot read the skills directory ${skillsDir}: ${messageOf(error)}`)
        return []
      }
      const candidates = []
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        let file
        let directory
        if (entry.isDirectory()) {
          file = join(skillsDir, entry.name, SKILL_FILE)
          directory = join(skillsDir, entry.name)
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          file = join(skillsDir, entry.name)
          directory = skillsDir
        } else {
          continue
        }
        const parsed = await readFrontmatter(file, cache, logger)
        if (parsed === null) continue
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
          invocation: parsed.invocation,
          provider: PROVIDER_NAME,
          source: SKILL_SOURCE,
          rank: SKILL_RANK,
          locator: { path: file, directory },
          resourceBase: { kind: 'directory', path: directory },
          path: file,
        })
      }
      return candidates
    },
    async get(candidate, options) {
      throwIfAborted(control?.signal ?? options?.signal)
      const locator = candidate?.locator
      const file = typeof locator?.path === 'string' ? locator.path : candidate?.path
      if (typeof file !== 'string') return undefined
      const directory = typeof locator?.directory === 'string' ? locator.directory : dirname(file)
      let raw
      try {
        raw = await readFile(file, 'utf8')
      } catch (error) {
        logger.warn(`cannot read ${file}: ${messageOf(error)}`)
        return undefined
      }
      const parsed = parseSkillFile(raw)
      if (parsed === null) {
        logger.warn(`${file} has no usable name/description frontmatter — skill skipped`)
        return undefined
      }
      return {
        name: parsed.name,
        description: parsed.description,
        ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
        invocation: parsed.invocation,
        provider: PROVIDER_NAME,
        source: SKILL_SOURCE,
        resourceBase: { kind: 'directory', path: directory },
        path: file,
        content: parsed.body,
      }
    },
  }
}

/**
 * Read and parse one skill file's frontmatter, reusing the previous parse while
 * the file's size and mtime are unchanged so a catalog refresh stays cheap.
 *
 * @param file - absolute SKILL.md path.
 * @param cache - citation-keyed parse cache owned by one provider.
 * @param logger - plugin logger.
 * @returns validated metadata, or `null` when the file is unreadable or invalid.
 */
async function readFrontmatter(file, cache, logger) {
  let info
  try {
    info = await stat(file)
  } catch {
    return null
  }
  if (!info.isFile()) return null
  const hit = cache.get(file)
  if (hit !== undefined && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit.meta
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    logger.warn(`cannot read ${file}: ${messageOf(error)}`)
    return null
  }
  const parsed = parseSkillFile(raw)
  let meta = null
  if (parsed === null) {
    logger.warn(`${file} has no usable name/description frontmatter — skill skipped`)
  } else if (!SKILL_NAME_PATTERN.test(parsed.name)) {
    logger.warn(`${file}: "${parsed.name}" is not a valid kebab-case skill name — skill skipped`)
  } else {
    meta = parsed
  }
  cache.set(file, { mtimeMs: info.mtimeMs, size: info.size, meta })
  return meta
}

/** Throw the caller's abort reason when the surrounding lookup was cancelled. */
function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new Error('aborted')
}

/** Render an unknown thrown value as a message. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

// ---- bootstrap -----------------------------------------------------------

/**
 * Build the lazily assembled bootstrap text provider. The body is read and
 * parsed once per process (the file does not change under a running session),
 * so the section provider is a string lookup on every later assembly.
 *
 * @param options - bootstrap inputs.
 * @param options.skillsDir - absolute skills root, or `undefined` when unresolved.
 * @param options.toolMapping - whether to append the dsh tool mapping.
 * @param options.logger - plugin logger.
 * @returns a function returning the section text (empty when unavailable).
 */
function createBootstrap({ skillsDir, toolMapping, logger }) {
  let cached
  return () => {
    if (cached !== undefined) return cached
    cached = composeBootstrap({ skillsDir, toolMapping, logger })
    return cached
  }
}

/**
 * Compose the `<EXTREMELY_IMPORTANT>` bootstrap: the `using-superpowers` body,
 * a preamble stating it is already loaded, the dsh tool mapping, and a pointer
 * to the long-form mapping reference when it ships.
 *
 * @param options - see {@link createBootstrap}.
 * @returns the bootstrap text, or `''` when the skill is unavailable.
 */
function composeBootstrap({ skillsDir, toolMapping, logger }) {
  if (skillsDir === undefined) return ''
  const file = join(skillsDir, BOOTSTRAP_SKILL, SKILL_FILE)
  let parsed
  try {
    parsed = parseSkillFile(readText(file))
  } catch (error) {
    logger.warn(`cannot read the using-superpowers bootstrap at ${file}: ${messageOf(error)}`)
    return ''
  }
  if (parsed === null) {
    logger.warn(`${file} has no usable name/description frontmatter — bootstrap skipped`)
    return ''
  }
  const parts = [
    '<EXTREMELY_IMPORTANT>',
    'You have superpowers.',
    '',
    BOOTSTRAP_MARKER,
    '',
    '**The `using-superpowers` skill content is included below. It is ALREADY LOADED — you are currently following it. Do NOT call the `skill` tool to load "using-superpowers" again.**',
    '',
    parsed.body,
  ]
  if (toolMapping) parts.push('', dshToolMapping(skillsDir))
  parts.push('</EXTREMELY_IMPORTANT>')
  return parts.join('\n')
}

/**
 * The dsh tool mapping: Superpowers skills name *actions*, and this translates
 * them into the tool names the DeepSeek Harness actually exposes. Kept in sync
 * with `references/dsh-tools.md` in this package.
 *
 * @param skillsDir - absolute skills root, used as the fallback reference location.
 * @returns the mapping block.
 */
function dshToolMapping(skillsDir) {
  const reference = locateToolMappingReference(skillsDir)
  const lines = [
    '## dsh tool mapping',
    '',
    'Skills name actions, not tools. On the DeepSeek Harness those actions are these tools:',
    '',
    '- **Invoke a skill** → the `skill` tool, with the skill\'s exact kebab-case name (`brainstorming`, `test-driven-development`, …). dsh exposes these skills without a `superpowers:` prefix; never work around the `skill` tool by reading a `SKILL.md` file yourself.',
    '- **Create or update todos** → `todo_write` (older `TodoWrite` references mean this).',
    '- Read a file → `read`; create a file → `write`; edit a file → `edit`; delete a file → `pwsh` (Windows) or `bash` (Unix).',
    '- Run a shell command → `pwsh` on Windows, `bash` on Unix. Long-running commands accept `run_in_background: true`; read them with `job_output` and stop them with `job_kill`.',
    '- Search file contents → `grep`; find files by name → `glob`.',
    '- Fetch a URL or search the web → `web_search`; when a `read_page` tool is available, use it to read one specific page.',
    '- **Dispatch a subagent** → `subagent` (background by default) or `subagent_fork` when the child must inherit this conversation; `Task (general-purpose):` in skill prose means this tool. Use `workflow` only for large planned fan-outs, and `ralph` only when a fresh agent must iterate over one objective.',
    '- Ask your human partner a question → `ask_user_question`.',
    '- Present a plan for approval → dsh plan mode (`exit_plan_mode` hands the plan to your human partner for approval or revision).',
    '- Track a long-running objective → the goal tools (`create_goal`, `get_goal`, `update_goal`).',
  ]
  if (reference !== undefined) {
    lines.push('', `The long form of this mapping is at \`${reference}\`.`)
  }
  return lines.join('\n')
}

/**
 * Locate the long-form tool mapping. This package ships its own copy (it is the
 * adapter's document, not upstream's), and falls back to the copy next to the
 * bootstrap skill when this adapter is checked out inside the Superpowers
 * repository.
 *
 * @param skillsDir - absolute skills root.
 * @returns the absolute path to an existing reference, or `undefined`.
 */
function locateToolMappingReference(skillsDir) {
  const candidates = [join(PLUGIN_DIR, TOOL_MAPPING_REFERENCE)]
  if (skillsDir !== undefined) candidates.push(join(skillsDir, BOOTSTRAP_SKILL, TOOL_MAPPING_REFERENCE))
  return candidates.find((candidate) => existsSync(candidate))
}

// ---- skill frontmatter ---------------------------------------------------
//
// A deliberately small reader for the shape Superpowers frontmatter uses — one
// `key: value` per line, optional quoting, optional `>`/`|` block scalar — so the
// plugin needs no YAML dependency in a repository that ships none. A line-based
// reader is also stricter about the failure that matters here: a description
// containing `: ` stays a description instead of being read as a nested key.

/**
 * Split a skill file into frontmatter fields and body.
 *
 * @param raw - file content.
 * @returns `{ name, description, whenToUse?, invocation, body }`, or `null` when
 *   the required `name` and `description` keys are missing.
 */
function parseSkillFile(raw) {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const fields = parseFrontmatter(text)
  const skillName = fields.name
  const description = fields.description
  if (typeof skillName !== 'string' || skillName === '') return null
  if (typeof description !== 'string' || description === '') return null
  const whenToUse = typeof fields.whenToUse === 'string' && fields.whenToUse !== '' ? fields.whenToUse : undefined
  return {
    name: skillName,
    description,
    ...(whenToUse === undefined ? {} : { whenToUse }),
    invocation: {
      modelInvocable: readBoolean(fields['disable-model-invocation']) !== true,
      userInvocable: readBoolean(fields['user-invocable']) !== false,
    },
    body: bodyAfterFrontmatter(text),
  }
}

/**
 * Parse the leading `---` fenced block of a skill file.
 *
 * @param text - file content without a BOM.
 * @returns the field map; empty when there is no frontmatter block.
 */
function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return {}
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      end = index
      break
    }
  }
  if (end === -1) return {}
  return parseFrontmatterLines(lines.slice(1, end))
}

/**
 * Read `key: value` lines, folding `>`/`|` block scalars that follow a bare key.
 *
 * @param lines - frontmatter lines without the fences.
 * @returns the field map.
 */
function parseFrontmatterLines(lines) {
  const fields = {}
  let key = null
  let style = ''
  let block = []
  const flush = () => {
    if (key === null) return
    fields[key] = style.startsWith('>') ? block.join(' ').trim() : block.join('\n').trim()
    key = null
    style = ''
    block = []
  }
  for (const line of lines) {
    const leadingSpace = /^\s/.test(line)
    if (!leadingSpace) {
      const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
      if (match !== null) {
        flush()
        const [, field, value] = match
        if (/^[>|][+-]?$/.test(value.trim())) {
          key = field
          style = value.trim()
          block = []
        } else {
          fields[field] = unquote(value.trim())
        }
        continue
      }
    }
    if (key !== null) block.push(line.trim())
  }
  flush()
  return fields
}

/** Strip one layer of matching quotes from a scalar value. */
function unquote(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

/** Read a YAML-ish boolean the way dsh's own skill provider does. */
function readBoolean(value) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  switch (value.trim().toLowerCase()) {
    case 'true': case 'yes': case 'on': case '1': return true
    case 'false': case 'no': case 'off': case '0': return false
    default: return undefined
  }
}

/**
 * Return the body after the closing frontmatter fence, trimmed — the same
 * shape dsh's filesystem provider hands the model.
 *
 * @param text - file content without a BOM.
 * @returns the skill body.
 */
function bodyAfterFrontmatter(text) {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return text.trim()
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') return lines.slice(index + 1).join('\n').trim()
  }
  return text.trim()
}

export default { name, inject, apply }
