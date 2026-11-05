'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const commands = require('../lib/commands');

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

test('frontmatter: plain, quoted and folded values', () => {
  const { meta, body } = commands.frontmatter('---\nname: x\ndescription: "a \\"b\\""\nargument-hint: \'[n]\'\nlong: >\n  one\n  two\n---\nBody\n');
  assert.equal(meta.name, 'x');
  assert.equal(meta.description, 'a "b"');
  assert.equal(meta['argument-hint'], '[n]');
  assert.equal(meta.long, 'one two');
  assert.equal(body, 'Body\n');
  assert.deepEqual(commands.frontmatter('no frontmatter').meta, {});
});

test('collect: every source, namespaces, hiding, precedence and order', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-cmds-'));
  try {
    const home = path.join(root, 'home');
    const repo = path.join(root, 'repo');
    const cwd = path.join(repo, 'sub');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    // project: cwd and the repo root above it; subfolder namespace; first line fallback
    write(path.join(cwd, '.claude/commands/hello.md'), '---\ndescription: Say hello\nargument-hint: [name]\n---\nHi $ARGUMENTS\n');
    write(path.join(repo, '.claude/commands/ops/deploy.md'), '# Deploy the thing\n\nsteps');
    write(path.join(root, '.claude/commands/outside.md'), 'above the git root: not loaded');
    write(path.join(cwd, '.claude/skills/pskill/SKILL.md'), '---\nname: pskill\ndescription: project skill\n---\n');
    // user command and skills; a skill of the same name replaces the command
    write(path.join(home, '.claude/commands/mine.md'), '---\ndescription: user cmd\n---\n');
    write(path.join(home, '.claude/commands/dup.md'), '---\ndescription: as command\n---\n');
    write(path.join(home, '.claude/skills/dup/SKILL.md'), '---\ndescription: as skill\n---\n');
    write(path.join(home, '.claude/skills/hidden/SKILL.md'), '---\ndescription: x\nuser-invocable: false\n---\n');
    write(path.join(home, '.claude/skills/off/SKILL.md'), '---\ndescription: x\n---\n');
    write(path.join(home, '.claude/skills/init/SKILL.md'), '---\ndescription: replaces the built-in\n---\n');
    write(path.join(home, '.claude/skills/synced/bucket/docs/SKILL.md'), '---\nname: docs\ndescription: synced\n---\n');
    // plugins: one enabled with a command and a skill, one disabled
    const pa = path.join(home, '.claude/plugins/cache/m/pa/1');
    const pb = path.join(home, '.claude/plugins/cache/m/pb/1');
    write(path.join(pa, 'commands/go.md'), '---\ndescription: plugin cmd\n---\n');
    write(path.join(pa, 'skills/sk/SKILL.md'), '---\ndescription: plugin skill\n---\n');
    write(path.join(pb, 'commands/no.md'), 'disabled');
    write(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'pa@m': [{ scope: 'user', installPath: pa }], 'pb@m': [{ scope: 'user', installPath: pb }] } }));
    write(path.join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'pa@m': true, 'pb@m': false }, skillOverrides: { off: 'off' } }));

    const list = commands.collect(cwd, home);
    const by = Object.fromEntries(list.map((c) => [c.name, c]));
    assert.equal(by.hello.source, 'project');
    assert.equal(by.hello.desc, 'Say hello');
    assert.equal(by.hello.hint, '[name]');
    assert.equal(by['ops:deploy'].desc, 'Deploy the thing');
    assert.equal(by.outside, undefined);
    assert.equal(by.pskill.source, 'skill');
    assert.equal(by.pskill.scope, 'project');
    assert.equal(by.mine.source, 'user');
    assert.equal(by.dup.desc, 'as skill');
    assert.equal(by.hidden, undefined);
    assert.equal(by.off, undefined);
    assert.equal(by.init.source, 'skill');
    assert.equal(by.docs.desc, 'synced');
    assert.equal(by.docs.scope, 'claude.ai');
    assert.equal(by['pa:go'].source, 'plugin');
    assert.equal(by['pa:sk'].source, 'plugin');
    assert.equal(by['pb:no'], undefined);
    assert.equal(by.clear.source, 'builtin');
    assert.ok(by.model.menu);
    // grouped: builtin, project, user, skill, plugin; alphabetical inside
    const groups = list.map((c) => c.source);
    const order = ['builtin', 'project', 'user', 'skill', 'plugin'];
    assert.deepEqual([...new Set(groups)], order);
    for (let i = 1; i < list.length; i++)
      if (list[i].source === list[i - 1].source) assert.ok(list[i - 1].name.localeCompare(list[i].name, 'en', { sensitivity: 'base' }) <= 0, `${list[i - 1].name} < ${list[i].name}`);
    // nothing but these fields leaves the module
    for (const c of list) for (const k of Object.keys(c)) assert.ok(['name', 'desc', 'hint', 'source', 'menu', 'scope'].includes(k), k);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('files: folder listing, name search, prefix before substring, cap', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-hub-files-'));
  try {
    for (const f of ['src/app.js', 'src/lib/map.js', 'README.md', 'node_modules/x/index.js', 'docs/apple.md']) write(path.join(root, f), '');
    let r = await commands.files(root, '');
    assert.deepEqual(r.files.map((f) => f.path), ['docs/', 'src/', 'README.md']);
    r = await commands.files(root, 'src/');
    assert.deepEqual(r.files.map((f) => f.path), ['src/lib/', 'src/app.js']);
    r = await commands.files(root, 'ap');
    assert.deepEqual(r.files.map((f) => f.path), ['docs/apple.md', 'src/app.js', 'src/lib/map.js']);
    assert.ok(!(await commands.files(root, 'index')).files.length, 'node_modules skipped');
    r = await commands.files(root, '', 1);
    assert.equal(r.files.length, 1);
    assert.equal(r.truncated, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('files: the home folder and what holds it are never walked', async () => {
  const home = os.homedir();
  assert.equal(commands.tooWide('/'), true);
  assert.equal(commands.tooWide(home), true);
  assert.equal(commands.tooWide(path.dirname(home)), true);
  assert.equal(commands.tooWide(path.join(home, 'Project')), false);
  assert.equal(commands.tooWide(os.tmpdir()), false);
  assert.deepEqual((await commands.files('/', '')).files, []);
});
