# dsh-superpowers

**Superpowers for the DeepSeek Harness (dsh).** Install it and your dsh agent gets all 14
[Superpowers](https://github.com/obra/superpowers) skills — brainstorming, planning, TDD,
debugging and the rest — and uses them by itself: when a task matches a skill, the agent loads
it before acting.

The bundled tree is **pinned to a recorded upstream tag** (`upstream.tag` in `package.json`,
currently `v6.3.0`) and **re-syncable**: `npm run sync-skills --check` reports how far the copy
has drifted from a newer checkout, and `npm run sync-skills` adopts it while keeping this
adapter's own additions. Nothing changes under the model's feet between releases, and nothing
drifts silently.

Two pieces do that:

1. **The skills are added to dsh's skill catalog**, so the agent sees them and loads any of
   them with dsh's own `skill` tool. Each skill keeps its own directory, so the scripts,
   prompts and templates it refers to resolve to their real location.
2. **A short "you have superpowers" bootstrap is added to the system prompt**, so the skills
   trigger from the first turn of every session — no setup, no per-session opt-in.

The package has **no dependencies** and needs no build step. The skills travel inside it:
`skills/` is a verbatim copy of the upstream Superpowers skills tree at the tag recorded in
`package.json` (`upstream.tag`), plus this adapter's own `references/dsh-tools.md` and the
one-line dsh pointer in `skills/using-superpowers/SKILL.md`. Upstream is MIT, Copyright (c)
2025 Jesse Vincent — see [LICENSE.superpowers](LICENSE.superpowers) and
[references/CREDITS.md](references/CREDITS.md). `npm run sync-skills` re-syncs that tree
against a newer upstream checkout and reports the drift.

Bundling is deliberate: a `github:obra/superpowers` dependency would make the skill source an
*exotic subdependency*, which pnpm refuses to install
(`ERR_PNPM_EXOTIC_SUBDEP: Exotic dependency "superpowers" (resolved via git-repository) is not
allowed in subdependencies`) — every user's install would fail. Shipping the tree keeps
`dsh plugin add` a plain, offline-capable install.

## Install

Requirements: a working dsh install (`dsh plugin`, plus the app on `PATH`) and Node 18 or
newer. The adapter is dependency-free and pure JS, so installation never triggers pnpm's build
approval and needs no network beyond the repository itself.

```bash
# from GitHub (canonical) — the repository is icanfinish11/dsh_superpowers;
# it installs the package dsh-superpowers
dsh plugin --profile web add icanfinish11/dsh_superpowers

# from a local checkout
dsh plugin --profile web add link:/path/to/dsh_superpowers
```

`dsh plugin` runs pnpm inside `$DSH_HOME/profiles/<name>/` and then reconciles the profile:
the package declares `dsh.bundle` in its `package.json`, so it is appended to
`dsh.profile.bundles` and its `cordis.patch.yml` is layered into the composed configuration.
The skills come from the copy inside the installed package — nothing else is fetched.

**Restart the harness afterwards** — bundle patches are read at boot.

Verify:

```bash
dsh --profile web --dump-config | grep -A6 superpowers     # the mounted row
dsh --profile headless "In one short sentence: do you have superpowers, and name two skills."
```

Then, in a session:

```bash
dsh --profile headless "Let's make a react todo list"
```

The first thing that should happen is the `brainstorming` skill loading — before any code.

## What you get

| Superpowers piece | dsh surface |
|---|---|
| `skills/` (14 skills) | `ctx.skills.registerProvider(...)` — one candidate per `<skills>/<name>/SKILL.md`, `resourceBase` set to the skill directory, rank `600` |
| `using-superpowers` bootstrap | `ctx.systemPrompt.section({ name: 'superpowers:bootstrap', order: 121 })`, assembled into every request from the first turn |
| SessionStart hook (Claude Code) | Not used. dsh has no session-start hook channel; the system-prompt registry is its always-on contribution point, and a section cannot be lost to compaction the way an injected history message can |
| Tool mapping (`references/<harness>-tools.md`) | [`references/dsh-tools.md`](references/dsh-tools.md), and the same mapping inlined into the bootstrap so the model has it without a file read |
| Subagents, todos, worktrees, TDD | dsh's own tools: `subagent` / `subagent_fork`, `todo_write`, `pwsh` / `bash`, `read` / `write` / `edit`, `grep` / `glob`, `web_search` |

## Where the skills come from

`skills/` in this package is the Superpowers skills tree, copied from upstream at the tag in
`package.json` (`upstream.tag`, currently `v6.3.0`), with two dsh-owned additions:

- `skills/using-superpowers/references/dsh-tools.md` — this adapter's tool mapping,
- one line in `skills/using-superpowers/SKILL.md`'s "Platform Adaptation" list pointing dsh at
  that file (the single `SKILL.md` edit the Superpowers porting guide allows).

The skills root is resolved at load time in this order, and the first candidate containing
`using-superpowers/SKILL.md` wins:

1. the plugin's `skillsDir` config
2. the `SUPERPOWERS_SKILLS_DIR` environment variable
3. `skills/` inside this package — the normal path
4. `../skills` beside this package — useful when a development copy sits next to a Superpowers
   checkout
5. the `skills/` directory of a `superpowers` package resolved as a dependency, if one is
   installed in the profile

If nothing resolves, the plugin logs a warning and degrades to bootstrap-only; it never fails
the profile boot.

### Adopting a new upstream release

```bash
git clone --depth 1 --branch vX.Y.Z https://github.com/obra/superpowers /tmp/superpowers
node scripts/sync-skills.mjs /tmp/superpowers --check   # report drift, write nothing
node scripts/sync-skills.mjs /tmp/superpowers           # re-copy, keeping the dsh additions
```

Then bump `version`, update `upstream.tag` and `upstream.synced` in `package.json`, review the
diff, and run the tests. The sync script preserves `references/dsh-tools.md` and re-applies the
platform pointer if upstream's copy of the file lacks it.

## Configuration

The patch mounts the row as `id: superpowers`. Override it per profile in
`$DSH_HOME/profiles/<name>/cordis.patch.yml` (a patch layer replaces the row's whole config,
so restate every key you want to keep):

```yaml
- id: superpowers
  config:
    skills: true          # register the skills catalog
    bootstrap: true       # inject the using-superpowers bootstrap
    toolMapping: true     # append the dsh tool mapping to the bootstrap
    order: 121            # system-prompt section order
    skillsDir: ''         # empty = automatic resolution
```

| Key | Default | Meaning |
|---|---|---|
| `skills` | `true` | Register the skills catalog as a skill provider. |
| `bootstrap` | `true` | Contribute the `superpowers:bootstrap` system-prompt section. |
| `toolMapping` | `true` | Append the dsh tool mapping to the bootstrap. |
| `order` | `121` | Section order; dsh renders ascending (`100`–`199` is the tool/behavior band). |
| `skillsDir` | `''` | Explicit skills root; empty resolves automatically. |

## Updating

```bash
dsh plugin --profile web add link:/path/to/dsh_superpowers   # re-link after local changes
```

For a newer Superpowers release, use the sync flow above; for a newer adapter release,
reinstall and restart the harness (the bundle layer is read at boot).

## Tests

```bash
node tests/test-plugin.mjs         # or: npm test / bash tests/run-tests.sh
```

The suite fakes dsh's `skills` and `systemPrompt` services, so it needs no harness install. It
verifies the provider contract, the bundled skills tree, frontmatter edge cases, the bootstrap
assembly, the tool mapping, and the degraded path.

## Troubleshooting

### The plugin is not loading

```bash
dsh plugin --profile web list
```

The package must be listed in `dsh.profile.bundles` inside
`$DSH_HOME/profiles/web/package.json`; `dsh plugin add` does that automatically for any
dependency declaring `dsh.bundle`. If it is missing, remove and re-add the package, then
restart.

### "skills directory not found"

The plugin could not resolve a skills root — the installed package is missing its `skills/`
tree (a partial checkout or a repackaged build). Point the plugin at a checkout instead:

```yaml
- id: superpowers
  config:
    skillsDir: /absolute/path/to/superpowers/skills
```

### The model does not know it has superpowers

The row is composed but the bundle layer is only read at boot: restart the harness. Then check
the plugin log line (`registered the Superpowers skill catalog from …`).

### A skill name collides with one of mine

dsh resolves duplicates by rank, nearest layer first: project roots (`100`/`200`) and user
roots (`400`/`500`) all outrank this provider (`600`), so your own skill keeps the name.

## Relationship to the in-repo port

Superpowers carries an in-repo dsh port (`.dsh-plugin/` + root `cordis.patch.yml`) so a fork of
that repository can be installed directly and an upstream PR can ship the integration there.
This package covers the other case: a standalone plugin that carries the skills with it, so it
installs from its own repository alone. The plugin module is the same code and resolves both
layouts.

## License

MIT — see [LICENSE](LICENSE). The bundled skills tree is Superpowers, MIT, Copyright (c) 2025
Jesse Vincent — see [LICENSE.superpowers](LICENSE.superpowers) and
[references/CREDITS.md](references/CREDITS.md).
