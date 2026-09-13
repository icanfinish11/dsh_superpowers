import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '..');
const pluginPath = resolve(packageRoot, 'index.js');
const patchPath = resolve(packageRoot, 'cordis.patch.yml');
const toolMappingPath = resolve(packageRoot, 'references/dsh-tools.md');
const creditsPath = resolve(packageRoot, 'references/CREDITS.md');
const bundledSkillsDir = resolve(packageRoot, 'skills');
const bootstrapSkillPath = resolve(bundledSkillsDir, 'using-superpowers/SKILL.md');
const upstreamToolsPath = resolve(bundledSkillsDir, 'using-superpowers/references/dsh-tools.md');

const EXPECTED_SKILLS = [
  'brainstorming',
  'dispatching-parallel-agents',
  'executing-plans',
  'finishing-a-development-branch',
  'receiving-code-review',
  'requesting-code-review',
  'subagent-driven-development',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'using-superpowers',
  'verification-before-completion',
  'writing-plans',
  'writing-skills',
];

const BOOTSTRAP_FIXTURE = [
  '---',
  'name: using-superpowers',
  'description: fixture bootstrap',
  '---',
  '',
  'fixture bootstrap body',
  '',
].join('\n');

/**
 * Load the plugin with a faked dsh context that records the contributions the
 * plugin makes to `ctx.skills` and `ctx.systemPrompt` — the two services the
 * real harness provides and this plugin injects.
 */
async function loadPlugin(config = {}) {
  const providers = [];
  const sections = [];
  const warnings = [];
  const ctx = {
    logger: () => ({
      info() {},
      warn: (message) => warnings.push(message),
      error: (message) => warnings.push(message),
    }),
    skills: {
      registerProvider: (create) => {
        providers.push(create({ signal: new AbortController().signal, invalidate() {} }));
        return () => {};
      },
    },
    systemPrompt: {
      section: (section) => {
        sections.push(section);
        return () => {};
      },
    },
  };
  const mod = await import(`${pathToFileURL(pluginPath).href}?cachebust=${Date.now()}-${Math.random()}`);
  mod.apply(ctx, config);
  return { mod, providers, sections, warnings };
}

function sectionText(section) {
  return typeof section.text === 'function' ? section.text({}) : section.text;
}

async function makeSkillsFixture(entries) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-superpowers-'));
  for (const [relative, content] of Object.entries(entries)) {
    const file = join(root, relative);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
  }
  return root;
}

test('package.json declares the dsh bundle, no dependencies and the upstream provenance', async () => {
  const pkg = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));

  assert.equal(pkg.name, 'dsh-superpowers');
  assert.deepEqual(pkg.dsh, { bundle: { patch: './cordis.patch.yml' } });
  assert.equal(pkg.repository.url, 'git+https://github.com/icanfinish11/dsh_superpowers.git');
  assert.deepEqual(pkg.exports, { '.': './index.js', './package.json': './package.json' });
  assert.ok(pkg.files.includes('references'), 'references/ ships with the package');
  assert.ok(pkg.files.includes('skills'), 'the skills tree ships with the package');
  assert.ok(pkg.keywords.includes('dsh-plugin'));

  // Self-contained by design: a git dependency would be an exotic subdependency,
  // which pnpm refuses to install (ERR_PNPM_EXOTIC_SUBDEP), so the skills are
  // bundled and the adapter itself must stay dependency-free.
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.peerDependencies, undefined);

  assert.equal(pkg.upstream.repository, 'https://github.com/obra/superpowers');
  assert.match(pkg.upstream.tag, /^v\d+\.\d+\.\d+$/, 'record the exact upstream tag the skills came from');
  assert.match(pkg.upstream.commit, /^[0-9a-f]{40}$/, 'record the exact upstream commit, not just the tag');
  assert.match(pkg.upstream.synced, /^\d{4}-\d{2}-\d{2}$/);
});

test('the bundled skills tree is complete and carries this adapter\'s dsh additions', async () => {
  const skills = await readdir(bundledSkillsDir, { withFileTypes: true });
  const directories = skills.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

  assert.deepEqual(directories, [...EXPECTED_SKILLS].sort());
  for (const name of directories) {
    assert.equal(existsSync(join(bundledSkillsDir, name, 'SKILL.md')), true, `${name}/SKILL.md should exist`);
  }

  // The dsh tool mapping ships inside the skills tree (so `references/dsh-tools.md`
  // resolves from the skill's own base directory) and the skill points at it.
  assert.equal(existsSync(upstreamToolsPath), true, 'skills/using-superpowers/references/dsh-tools.md should exist');
  const bootstrap = await readFile(bootstrapSkillPath, 'utf8');
  assert.match(bootstrap, /DeepSeek Harness \(dsh\): `references\/dsh-tools\.md`/);
});

test('cordis.patch.yml mounts this package by name and the entry file exists', async () => {
  assert.equal(existsSync(patchPath), true, 'cordis.patch.yml should exist');
  const pkg = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
  const patch = await readFile(patchPath, 'utf8');

  assert.match(patch, /^- insert:/m);
  assert.match(patch, /id: superpowers/);
  assert.match(patch, new RegExp(`name: '${pkg.name}'`), 'the row must name the installed package');
  assert.equal(existsSync(pluginPath), true, 'index.js must exist next to the patch');
});

test('plugin exports the cordis shape dsh loads and injects both services', async () => {
  const { mod } = await loadPlugin({ skillsDir: bundledSkillsDir });

  assert.equal(mod.name, 'superpowers');
  assert.deepEqual([...mod.inject], ['skills', 'systemPrompt']);
  assert.equal(typeof mod.apply, 'function');
  assert.equal(mod.default.name, 'superpowers');
});

test('apply registers one skill provider and one bootstrap section', async () => {
  const { providers, sections, warnings } = await loadPlugin({ skillsDir: bundledSkillsDir });

  assert.equal(providers.length, 1);
  assert.equal(providers[0].name, 'superpowers');
  assert.equal(typeof providers[0].list, 'function');
  assert.equal(typeof providers[0].get, 'function');

  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, 'superpowers:bootstrap');
  assert.equal(sections[0].order, 121);
  assert.equal(typeof sections[0].text, 'function', 'section text should be evaluated per assembly');
  assert.deepEqual(warnings, []);
});

test('the bundled skills root resolves without any config', async () => {
  // No skillsDir: resolution must find the skills bundled in this package.
  const { providers, warnings } = await loadPlugin();
  const candidates = await providers[0].list({ cwd: packageRoot });

  assert.deepEqual(
    candidates.map((candidate) => candidate.name).sort(),
    [...EXPECTED_SKILLS].sort(),
  );
  for (const candidate of candidates) {
    assert.match(candidate.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${candidate.name} is not kebab-case`);
    assert.ok(candidate.description.length > 0, `${candidate.name} needs a description`);
    assert.equal(candidate.provider, 'superpowers');
    assert.equal(candidate.source, 'superpowers');
    assert.equal(candidate.rank, 600);
    assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true });
    // A package manager may report either the symlinked package path or the real
    // path inside its virtual store; both point at the same skill directory.
    assert.deepEqual(candidate.resourceBase, { kind: 'directory', path: dirname(candidate.path) });
    assert.equal(realpathSync(candidate.resourceBase.path), realpathSync(join(bundledSkillsDir, candidate.name)));
    assert.equal(existsSync(candidate.path), true, `${candidate.name} locator should exist on disk`);
  }
  assert.deepEqual(warnings, []);

  const definitions = await Promise.all(candidates.map((candidate) => providers[0].get(candidate, {})));
  for (const definition of definitions) {
    assert.ok(definition.content.length > 0, `${definition.name} body should not be empty`);
    assert.ok(!definition.content.startsWith('---'), `${definition.name} body should have frontmatter stripped`);
  }

  const brainstorming = candidates.find((candidate) => candidate.name === 'brainstorming');
  assert.match(brainstorming.description, /^You MUST use this before any creative work/);
});

test('get() strips frontmatter and bases resources at the skill directory', async () => {
  const fixture = await makeSkillsFixture({
    'using-superpowers/SKILL.md': BOOTSTRAP_FIXTURE,
    'requesting-code-review/SKILL.md': [
      '---',
      'name: requesting-code-review',
      'description: fixture',
      '---',
      '',
      'Dispatch a subagent with the template at [code-reviewer.md](code-reviewer.md).',
    ].join('\n'),
    'requesting-code-review/code-reviewer.md': '# reviewer template',
  });
  try {
    const { providers } = await loadPlugin({ skillsDir: fixture });
    const [candidate] = await providers[0].list({});
    const definition = await providers[0].get(candidate, {});

    assert.equal(definition.name, 'requesting-code-review');
    assert.equal(definition.provider, 'superpowers');
    assert.deepEqual(definition.resourceBase, { kind: 'directory', path: join(fixture, 'requesting-code-review') });
    assert.match(definition.content, /^Dispatch a subagent/);
    assert.ok(!definition.content.includes('description: fixture'));
    // The model-facing resource hint is the base directory, so the relative
    // reference the body names resolves against it.
    assert.equal(existsSync(join(definition.resourceBase.path, 'code-reviewer.md')), true);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('get() returns undefined for an unreadable locator instead of throwing', async () => {
  const { providers, warnings } = await loadPlugin({ skillsDir: bundledSkillsDir });
  const definition = await providers[0].get({ locator: { path: join(packageRoot, 'nope/SKILL.md') } }, {});

  assert.equal(definition, undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /cannot read/);
});

test('the bootstrap section carries the body, the marker and the dsh tool mapping', async () => {
  const { sections } = await loadPlugin({ skillsDir: bundledSkillsDir });
  const text = sectionText(sections[0]);

  assert.ok(text.startsWith('<EXTREMELY_IMPORTANT>'));
  assert.ok(text.endsWith('</EXTREMELY_IMPORTANT>'));
  assert.match(text, /superpowers:using-superpowers bootstrap for dsh/);
  assert.match(text, /do NOT call the `skill` tool to load "using-superpowers" again/i);
  assert.match(text, /## dsh tool mapping/);
  assert.match(text, /`skill` tool/);
  assert.match(text, /`todo_write`/);
  assert.match(text, /`subagent`/);
  assert.match(text, /`ask_user_question`/);

  // The long form points at this package's own copy of the mapping.
  assert.ok(text.includes(toolMappingPath), `expected the mapping pointer to ${toolMappingPath}`);
  assert.equal(sectionText(sections[0]), text, 'assembled once per process');
});

test('the bootstrap body comes from the resolved skills root', async () => {
  const { sections } = await loadPlugin();
  const text = sectionText(sections[0]);

  // A line that exists in the real using-superpowers body, not in any fixture.
  assert.match(text, /If you think there is even a 1% chance a skill might apply/);
  assert.match(text, /## Red Flags/);
  assert.ok(!text.includes('name: using-superpowers'), 'frontmatter should be stripped');
});

test('toolMapping, skills and bootstrap can be disabled independently', async () => {
  const noMapping = await loadPlugin({ skillsDir: bundledSkillsDir, toolMapping: false });
  const mappingText = sectionText(noMapping.sections[0]);
  assert.match(mappingText, /You have superpowers\./);
  assert.ok(!mappingText.includes('## dsh tool mapping'));

  const noSkills = await loadPlugin({ skillsDir: bundledSkillsDir, skills: false });
  assert.equal(noSkills.providers.length, 0);
  assert.equal(noSkills.sections.length, 1);

  const noBootstrap = await loadPlugin({ skillsDir: bundledSkillsDir, bootstrap: false });
  assert.equal(noBootstrap.providers.length, 1);
  assert.equal(noBootstrap.sections.length, 0);

  const overridden = await loadPlugin({ skillsDir: bundledSkillsDir, order: 130 });
  assert.equal(overridden.sections[0].order, 130);
});

test('frontmatter edge cases parse or drop cleanly', async () => {
  const fixture = await makeSkillsFixture({
    'using-superpowers/SKILL.md': BOOTSTRAP_FIXTURE,
    'quoted/SKILL.md': ['---', 'name: quoted', 'description: "Vision toolkit: OCR, grounding and pixel diff."', '---', '', 'quoted body'].join('\n'),
    'block/SKILL.md': ['---', 'name: block', 'description: >', '  Folded description', '  across two lines.', '---', '', 'body'].join('\n'),
    'flat.md': ['---', 'name: flat', 'description: A flat single-file skill.', '---', '', 'flat body'].join('\n'),
    'bad-name/SKILL.md': ['---', 'name: Not Kebab', 'description: Bad name.', '---', '', 'body'].join('\n'),
    'no-description/SKILL.md': ['---', 'name: no-description', '---', '', 'body'].join('\n'),
    '.hidden/SKILL.md': ['---', 'name: hidden', 'description: Never surfaces.', '---', '', 'body'].join('\n'),
    'user-only/SKILL.md': ['---', 'name: user-only', 'description: User-invocable only.', 'disable-model-invocation: true', '---', '', 'body'].join('\n'),
  });
  try {
    const { providers, warnings } = await loadPlugin({ skillsDir: fixture });
    const candidates = await providers[0].list({});

    assert.deepEqual(candidates.map((candidate) => candidate.name).sort(), ['block', 'flat', 'quoted', 'user-only', 'using-superpowers']);
    // A line-based reader keeps a description containing ": " intact.
    assert.equal(candidates.find((c) => c.name === 'quoted').description, 'Vision toolkit: OCR, grounding and pixel diff.');
    assert.equal(candidates.find((c) => c.name === 'block').description, 'Folded description across two lines.');
    assert.deepEqual(candidates.find((c) => c.name === 'flat').resourceBase, { kind: 'directory', path: fixture });
    assert.deepEqual(candidates.find((c) => c.name === 'user-only').invocation, { modelInvocable: false, userInvocable: true });
    assert.equal(warnings.length, 2, `expected two drops, got: ${warnings.join(' | ')}`);

    // A revision is picked up once the file changes.
    await writeFile(join(fixture, 'quoted/SKILL.md'), ['---', 'name: quoted', 'description: Rewritten.', '---', '', 'body'].join('\n'), 'utf8');
    const relisted = await providers[0].list({});
    assert.equal(relisted.find((c) => c.name === 'quoted').description, 'Rewritten.');
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('a host with no skills root degrades without failing activation', async () => {
  const isolated = await mkdtemp(join(tmpdir(), 'dsh-superpowers-isolated-'));
  const previous = process.env.SUPERPOWERS_SKILLS_DIR;
  try {
    const copy = join(isolated, 'index.js');
    await writeFile(copy, await readFile(pluginPath, 'utf8'), 'utf8');
    process.env.SUPERPOWERS_SKILLS_DIR = join(isolated, 'nowhere');

    const providers = [];
    const sections = [];
    const warnings = [];
    const mod = await import(`${pathToFileURL(copy).href}?cachebust=${Date.now()}-${Math.random()}`);
    mod.apply({
      logger: () => ({ info() {}, warn: (message) => warnings.push(message), error: (message) => warnings.push(message) }),
      skills: { registerProvider: (create) => providers.push(create({ signal: new AbortController().signal, invalidate() {} })) },
      systemPrompt: { section: (section) => sections.push(section) },
    }, {});

    assert.equal(providers.length, 0, 'no provider should register without a skills root');
    assert.equal(sections.length, 1, 'the section still registers so the composition is unchanged');
    assert.equal(sectionText(sections[0]), '', 'the bootstrap section should render empty');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /skills directory not found/);
  } finally {
    if (previous === undefined) delete process.env.SUPERPOWERS_SKILLS_DIR;
    else process.env.SUPERPOWERS_SKILLS_DIR = previous;
    await rm(isolated, { recursive: true, force: true });
  }
});

test('scripts the skills invoke directly keep their executable bit', async (t) => {
  // The skills call these as `scripts/<name> …`, which needs the executable bit
  // on Unix. A copy made on Windows loses it silently, so assert the git index
  // rather than the working tree.
  const executable = [
    'skills/brainstorming/scripts/start-server.sh',
    'skills/brainstorming/scripts/stop-server.sh',
    'skills/subagent-driven-development/scripts/review-package',
    'skills/subagent-driven-development/scripts/sdd-workspace',
    'skills/subagent-driven-development/scripts/task-brief',
    'skills/systematic-debugging/find-polluter.sh',
    'skills/writing-skills/render-graphs.js',
    'tests/run-tests.sh',
  ];
  let listing;
  try {
    listing = execFileSync('git', ['-C', packageRoot, 'ls-files', '-s', ...executable], { encoding: 'utf8' });
  } catch {
    t.skip('git is not available');
    return;
  }
  for (const line of listing.trim().split('\n')) {
    const [meta, path] = line.split('\t');
    assert.equal(meta.split(/\s+/)[0], '100755', `${path} should be recorded as executable`);
  }
});

test('the shipped docs cover the mapping and the upstream attribution', async () => {
  assert.equal(existsSync(toolMappingPath), true, 'references/dsh-tools.md should exist');
  const rows = (await readFile(toolMappingPath, 'utf8')).split('\n').filter((line) => line.startsWith('|'));
  for (const pattern of [/`skill`/, /todo/i, /subagent/i, /pwsh|bash/i, /grep/i, /web_search/i, /ask_user_question/i]) {
    assert.ok(rows.some((row) => pattern.test(row)), `mapping table should cover ${pattern}`);
  }

  assert.equal(existsSync(creditsPath), true, 'references/CREDITS.md should exist');
  const credits = await readFile(creditsPath, 'utf8');
  assert.match(credits, /obra\/superpowers/);
  assert.match(credits, /Jesse Vincent/);
  assert.match(credits, /MIT/);
});
