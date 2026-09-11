# Credits

## This repository

`dsh_superpowers` is an independent DeepSeek Harness adapter by **icanfinish11**.
It contains the dsh integration — the plugin module, the dsh bundle patch, the
dsh tool mapping, tests and docs — together with a copy of the Superpowers
skills, described below.

## Upstream

**Superpowers** is by **Jesse Vincent** and the team at **Prime Radiant**:

- Repository: <https://github.com/obra/superpowers>
- License: MIT (Copyright (c) 2025 Jesse Vincent) — full text in
  [`LICENSE.superpowers`](../LICENSE.superpowers)
- npm: not published

`skills/` in this repository is the upstream skills tree, copied verbatim from
tag **v6.3.0** (the tag is recorded in `package.json` → `upstream`). It carries
exactly two dsh-owned additions:

| Path | What it is |
|---|---|
| `skills/using-superpowers/references/dsh-tools.md` | This adapter's tool mapping — our document, not upstream's |
| `skills/using-superpowers/SKILL.md` → "Platform Adaptation" | One added pointer line to the file above (the single `SKILL.md` edit the Superpowers porting guide allows for a new harness) |

Everything else in `skills/` — the 14 skill bodies, the `using-superpowers`
bootstrap, every prompt and reference — is upstream's, unmodified.

The copy exists because the standalone install path cannot fetch from upstream:
a `github:` dependency would make the skill source an *exotic subdependency*,
which pnpm refuses to install (`ERR_PNPM_EXOTIC_SUBDEP`), breaking
`dsh plugin add` for every user. `npm run sync-skills` re-copies the tree from a
newer upstream checkout, preserves the two files above, and reports the diff, so
the copy is refreshed deliberately rather than drifting.

When this adapter is instead used as the in-repo port inside a Superpowers fork
(`.dsh-plugin/`), it serves that checkout's `skills/` directly and no copy is
involved.
