# Credits

## This repository

`dsh_superpowers` is an independent DeepSeek Harness adapter by **icanfinish11**.
It contains the dsh integration only: the plugin module, the dsh bundle patch, the
dsh tool mapping, tests and docs. There is no Superpowers content in this
repository.

## Upstream

**Superpowers** is by **Jesse Vincent** and the team at **Prime Radiant**:

- Repository: <https://github.com/obra/superpowers>
- License: MIT (Copyright (c) 2025 Jesse Vincent)
- npm: not published — the dependency is fetched from the repository above

The 14 skills, the `using-superpowers` bootstrap, and every prompt this adapter
serves at runtime come from that repository. They are installed as an ordinary
npm dependency (`"superpowers": "github:obra/superpowers#v6.3.0"` in
`package.json`), which means:

- the installed skills are the original author's files, not a re-uploaded copy;
- updating this adapter's pinned tag is the only way upstream content changes;
- nothing upstream is vendored, edited, or re-published here.

The one file this adapter adds *inside* the skills tree when it is used as the
in-repo port (`skills/using-superpowers/references/dsh-tools.md`) is the dsh tool
mapping, which is this adapter's own document.
