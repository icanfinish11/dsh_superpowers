// Refresh the bundled skills from a Superpowers checkout.
//
// `skills/` in this repository is a copy of the upstream Superpowers skills tree
// plus this adapter's own `references/dsh-tools.md` and the one-line dsh pointer
// in `skills/using-superpowers/SKILL.md`. This script re-copies the upstream tree
// onto that baseline and reports what changed, so an upstream release can be
// adopted deliberately: clone upstream at the tag you want, run this, review the
// diff, then update `upstream.tag` in package.json.
//
// Usage:
//   node scripts/sync-skills.mjs /path/to/superpowers-checkout [--tag v6.3.0]
//   node scripts/sync-skills.mjs            # defaults to ../superpowers
//   node scripts/sync-skills.mjs --check    # report drift, write nothing
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(packageRoot, 'skills');
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const recorded = manifest.upstream ?? {};

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const tagIndex = args.indexOf('--tag');
const tag = tagIndex === -1 ? undefined : args[tagIndex + 1];
const source = resolve(args.find((arg) => !arg.startsWith('--') && arg !== tag) ?? join(packageRoot, '..', 'superpowers'));
const sourceSkills = join(source, 'skills');

// Files this adapter owns inside the skills tree and must keep across a sync.
const KEEP = [
  'using-superpowers/references/dsh-tools.md',
];

if (!existsSync(join(sourceSkills, 'using-superpowers', 'SKILL.md'))) {
  console.error(`no Superpowers skills tree at ${sourceSkills}`);
  console.error('clone it first, e.g. git clone --depth 1 --branch v6.3.0 https://github.com/obra/superpowers');
  process.exit(2);
}

/** HEAD of the source checkout, when the source is a git work tree. */
function sourceHead() {
  try {
    return execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

const head = sourceHead();
console.log(`recorded pin: ${recorded.repository ?? '(none)'} ${recorded.tag ?? ''} ${recorded.commit ?? ''}`.trimEnd());
if (head !== undefined) console.log(`checkout HEAD: ${head}`);
const pinMismatch = head !== undefined && recorded.commit !== undefined && recorded.commit !== head;
if (pinMismatch) {
  console.log('pin mismatch: the checkout is not the commit recorded in package.json — a sync must update "upstream.tag"/"upstream.commit".');
}

/** Every file under a directory, as repo-relative POSIX paths. */
function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(root, full).split('\\').join('/'));
    }
  };
  walk(root);
  return out.sort();
}

const before = existsSync(target) ? listFiles(target) : [];
const kept = new Map();
for (const file of KEEP) {
  const full = join(target, file);
  if (existsSync(full)) kept.set(file, readFileSync(full, 'utf8'));
}

const changes = [];
const upstreamFiles = listFiles(sourceSkills);
for (const file of upstreamFiles) {
  if (kept.has(file)) continue;
  const from = join(sourceSkills, file);
  const to = join(target, file);
  const same = existsSync(to) && readFileSync(from).equals(readFileSync(to));
  if (!same) changes.push(`${existsSync(to) ? 'changed' : 'added'}  ${file}`);
}
for (const file of before) {
  if (!upstreamFiles.includes(file) && !kept.has(file)) changes.push(`removed  ${file}`);
}

if (changes.length === 0 && !pinMismatch) {
  console.log(`skills/ already matches ${sourceSkills}${tag === undefined ? '' : ` (${tag})`}, and the recorded pin is current`);
  process.exit(0);
}

if (changes.length > 0) {
  console.log(`${checkOnly ? 'drift' : 'sync'} against ${sourceSkills}${tag === undefined ? '' : ` (${tag})`}:`);
  for (const line of changes) console.log(`  ${line}`);
}

if (checkOnly) {
  console.log(`\nrun without --check to apply${changes.length === 0 ? ' (to update the recorded pin)' : ''}`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(sourceSkills, target, { recursive: true });
for (const [file, content] of kept) {
  const full = join(target, file);
  if (!existsSync(dirname(full))) cpSync(dirname(full), dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

// Re-apply the allowed SKILL.md pointer when upstream's copy lacks it.
const skillFile = join(target, 'using-superpowers', 'SKILL.md');
const pointer = '- DeepSeek Harness (dsh): `references/dsh-tools.md`';
const body = readFileSync(skillFile, 'utf8');
if (!body.includes(pointer)) {
  const anchor = /^(- (?:Codex|Pi|Antigravity|Hermes Agent)[^\n]*\n)(?!- )/m;
  const patched = anchor.test(body)
    ? body.replace(anchor, `$1${pointer}\n`)
    : `${body.trimEnd()}\n\n${pointer}\n`;
  writeFileSync(skillFile, patched, 'utf8');
  console.log(`  re-applied the dsh pointer in ${relative(packageRoot, skillFile)}`);
}

console.log(`\ndone — ${statSync(target).isDirectory() ? 'skills/ refreshed' : 'nothing to do'}`);
if (tag !== undefined) {
  console.log(`remember to set "upstream.tag": "${tag}" in package.json`);
} else {
  console.log('remember to update "upstream.tag" and "upstream.synced" in package.json');
}
if (head !== undefined) {
  console.log(`and "upstream.commit": "${head}"`);
}
