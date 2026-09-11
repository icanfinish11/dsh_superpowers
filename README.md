# dsh_superpowers

[Superpowers](https://github.com/obra/superpowers) for the **DeepSeek Harness (dsh)** — a
self-contained dsh plugin package that

1. registers the Superpowers skills as a dsh **skill catalog** (14 skills, loaded with dsh's
   native `skill` tool, with each skill's directory handed to the model as its resource base), and
2. injects the **`using-superpowers` bootstrap** — plus a dsh tool mapping — as an always-on
   system-prompt section, so the skills auto-trigger from the first turn of every session with
   no per-session opt-in.

The skill content is **not** vendored here: it is installed from the original author's
repository as an npm dependency (`"superpowers": "github:obra/superpowers#v6.3.0"`). This
repository ships the dsh adapter only — the plugin module, the bundle patch, the tool mapping,
tests and docs. See [references/CREDITS.md](references/CREDITS.md).

## Install

Requirements: a working dsh install (`dsh plugin`, plus the app on `PATH`) and Node 18 or
newer. The adapter itself has no dependencies and needs no build step, so installation never
triggers pnpm's build approval.

```bash
# from GitHub (canonical)
dsh plugin --profile web add icanfinish11/dsh_superpowers

# from a local checkout
dsh plugin --profile web add link:/path/to/dsh_superpowers
```

`dsh plugin` runs pnpm inside `$DSH_HOME/profiles/<name>/` and then reconciles the profile:
the package declares `dsh.bundle` in its `package.json`, so it is appended to
`dsh.profile.bundles` and its `cordis.patch.yml` is layered into the composed configuration.
Install also fetches the pinned `superpowers` dependency, which is where the skills come from.

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

The skills root is resolved in this order, and the first candidate containing
`using-superpowers/SKILL.md` wins:

1. the plugin's `skillsDir` config
2. the `SUPERPOWERS_SKILLS_DIR` environment variable
3. `skills/` inside this package (an adapter that vendors the skills next to its entry point)
4. `../skills` beside this package (the in-repo layout, where this adapter is checked out as
   `<superpowers>/.dsh-plugin/`)
5. the `skills/` directory of the dependency `superpowers` — the normal standalone path

If nothing resolves, the plugin logs a warning and degrades to bootstrap-only; it never fails
the profile boot.

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

To move to a newer Superpowers release, bump the pinned tag in `package.json`
(`"superpowers": "github:obra/superpowers#vX.Y.Z"`), reinstall, and restart. Pinning is
deliberate: the adapter is written against a known upstream revision, and an unpinned
dependency would change model-facing content without a version bump here.

## Tests

```bash
node tests/test-plugin.mjs         # or: npm test / bash tests/run-tests.sh
```

The suite fakes dsh's `skills` and `systemPrompt` services, so it needs no harness install. It
verifies the provider contract, frontmatter edge cases, the bootstrap assembly, the tool
mapping, and the degraded path — and, when the `superpowers` dependency is installed, that all
14 upstream skills are discovered with their real descriptions.

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

The plugin could not resolve a skills root — usually because the `superpowers` dependency did
not install (git unavailable, or no network to GitHub). Re-run the install, or point the plugin
at a checkout:

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
that repository can be installed directly and an upstream PR can ship the integration. This
package covers the other case: a standalone adapter that consumes Superpowers as a dependency
and vendors nothing. The plugin module is the same code and resolves both layouts.

## License

MIT — see [LICENSE](LICENSE). Superpowers itself is MIT, Copyright (c) 2025 Jesse Vincent, and
is consumed as a dependency; see [references/CREDITS.md](references/CREDITS.md).
