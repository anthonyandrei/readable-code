const assert = require('node:assert/strict');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const pluginRoot = path.resolve(__dirname, '..');
const script = path.join(pluginRoot, 'hooks/document-code.cjs');

/** Create a disposable checkout and hook runner; remove only this test's temporary tree. */
function fixture(t, { repository = true, committed = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'readable code-'));
  const cwd = path.join(directory, 'repo with spaces');
  const data = path.join(directory, 'hook data');
  fs.mkdirSync(cwd);
  t.after(() => {
    const relative = path.relative(os.tmpdir(), directory);
    assert.ok(relative.startsWith('readable code-') && !path.isAbsolute(relative));
    fs.rmSync(directory, { recursive: true, force: true });
  });

  /** Run a fixture-only Git command without invoking hooks or signing commits. */
  function git(...args) {
    return execFileSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...args], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  /** Write fixture content and return its absolute path. */
  function write(file, content) {
    const target = path.join(cwd, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return target;
  }

  if (repository) {
    git('init', '--quiet');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'core.autocrlf', 'false');
    git('config', 'core.hooksPath', path.join(directory, 'no-hooks'));
    write('main.py', 'def main():\n    return 1\n');
    write('other.py', 'def other():\n    return 2\n');
    if (committed) {
      git('add', '.');
      git('commit', '--quiet', '-m', 'Fixture');
    }
  }

  const env = { ...process.env, PLUGIN_ROOT: pluginRoot, PLUGIN_DATA: data };

  /** Construct the documented Codex event envelope for this fixture. */
  function event(name, extra = {}) {
    return {
      hook_event_name: name, cwd, session_id: 'session-1', turn_id: 'turn-1',
      ...(name === 'PostToolUse' ? { tool_name: 'Bash' } : {}), ...extra,
    };
  }

  /** Invoke the real hook process and parse its protocol output. */
  function run(name, extra = {}) {
    const result = spawnSync(process.execPath, [script], {
      input: JSON.stringify(event(name, extra)), encoding: 'utf8', env, windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  }

  /** Combine independently written candidate receipts, including edits after the reminder. */
  function reviewPaths() {
    const receipts = fs.readdirSync(data, { recursive: true })
      .filter(file => /^edit-.*\.json$/.test(path.basename(file)));
    return [...new Set(receipts.flatMap(file => JSON.parse(fs.readFileSync(path.join(data, file), 'utf8'))))].sort();
  }

  return { cwd, data, env, event, git, write, run, reviewPaths };
}

test('read-only turns ignore existing dirty and untracked source files', t => {
  const f = fixture(t);
  f.write('other.py', 'def other():\n    return 9\n');
  f.write('preexisting.py', 'def pending():\n    return 0\n');
  f.run('UserPromptSubmit');
  assert.deepEqual(f.run('PostToolUse'), {});
  assert.deepEqual(f.run('Stop'), {});
});

test('shell edits include changed and new source, excluding unchanged dirty code', t => {
  const f = fixture(t);
  f.write('other.py', 'def other():\n    return 9\n');
  f.run('UserPromptSubmit');
  const changed = f.write('main.py', 'def main():\n    return 3\n');
  const added = f.write('new source.py', 'def added():\n    return 4\n');
  const before = fs.readFileSync(changed, 'utf8');
  const result = f.run('PostToolUse');
  assert.equal(result.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(result.hookSpecificOutput.additionalContext, /Before your final response/);
  assert.equal(result.decision, undefined);
  assert.deepEqual(f.reviewPaths(), [changed, added].sort());
  assert.equal(fs.readFileSync(changed, 'utf8'), before, 'hook must not rewrite source');
});

test('documentation-only changes do not trigger a code pass', t => {
  const f = fixture(t);
  f.run('UserPromptSubmit');
  f.write('README.md', 'Updated prose.\n');
  assert.deepEqual(f.run('PostToolUse'), {});
});

test('direct writes work outside Git and preserve unusual path characters', t => {
  const f = fixture(t, { repository: false });
  f.run('UserPromptSubmit');
  const file = f.write('source with spaces & unicode λ.py', 'def work():\n    pass\n');
  const result = f.run('PostToolUse', { tool_name: 'Write', tool_input: { file_path: file } });
  assert.equal(result.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.ok(result.hookSpecificOutput.additionalContext.includes('document-code'));
  assert.ok(result.hookSpecificOutput.additionalContext.includes('edit-*.json'));
  const receipts = fs.readdirSync(f.data, { recursive: true });
  const turnDirectory = path.dirname(path.join(f.data, receipts.find(file => path.basename(file) === 'review-requested')));
  assert.ok(result.hookSpecificOutput.additionalContext.includes(JSON.stringify(turnDirectory)));
  assert.deepEqual(f.reviewPaths(), [file]);
});

test('patch moves review the destination and skip deleted source', t => {
  const f = fixture(t, { repository: false });
  const moved = f.write('renamed module.py', 'def work():\n    pass\n');
  const result = f.run('PostToolUse', {
    tool_name: 'apply_patch',
    tool_input: { command: '*** Begin Patch\n*** Update File: old.py\n*** Move to: renamed module.py\n@@\n-x\n+y\n*** Delete File: gone.py\n*** End Patch' },
  });
  assert.equal(result.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.deepEqual(f.reviewPaths(), [moved]);
});

test('failed direct edits do not create a reminder', t => {
  const f = fixture(t, { repository: false });
  const file = f.write('existing.py', 'def work():\n    pass\n');
  assert.deepEqual(f.run('PostToolUse', {
    tool_name: 'Edit', tool_input: { file_path: file }, tool_response: { isError: true },
  }), {});
  assert.deepEqual(f.reviewPaths(), []);
});

test('one reminder covers later source edits and documentation changes without continuing at Stop', t => {
  const f = fixture(t);
  f.run('UserPromptSubmit');
  const changed = f.write('main.py', 'def main():\n    return 3\n');
  assert.ok(f.run('PostToolUse').hookSpecificOutput);
  const later = f.write('later.py', 'def later():\n    return 4\n');
  assert.deepEqual(f.run('PostToolUse'), {});
  f.write('main.py', 'def main():\n    """Return the result."""\n    return 3\n');
  assert.deepEqual(f.run('PostToolUse'), {});
  assert.deepEqual(f.reviewPaths(), [changed, later].sort());
  assert.deepEqual(f.run('Stop'), {});
  assert.deepEqual(f.run('Stop', { stop_hook_active: true }), {});
});

test('later turns and different sessions do not inherit prior completion work', t => {
  const f = fixture(t);
  f.run('UserPromptSubmit');
  f.write('main.py', 'def main():\n    return 3\n');
  assert.ok(f.run('PostToolUse').hookSpecificOutput);
  f.run('UserPromptSubmit', { turn_id: 'turn-2' });
  assert.deepEqual(f.run('PostToolUse', { turn_id: 'turn-2' }), {});
  f.run('UserPromptSubmit', { session_id: 'session-2' });
  assert.deepEqual(f.run('PostToolUse', { session_id: 'session-2' }), {});
  f.write('main.py', 'def main():\n    return 5\n');
  assert.ok(f.run('PostToolUse', { turn_id: 'turn-2' }).hookSpecificOutput);
  assert.ok(f.run('PostToolUse', { session_id: 'session-2' }).hookSpecificOutput);
});

test('Git staging alone does not count as a source change', t => {
  const f = fixture(t);
  f.write('main.py', 'def main():\n    return 3\n');
  f.run('UserPromptSubmit');
  f.git('add', '.');
  assert.deepEqual(f.run('PostToolUse'), {});
});

test('shell changes committed during the task are still reviewed', t => {
  const f = fixture(t);
  f.write('other.py', 'def other():\n    return 9\n');
  f.run('UserPromptSubmit');
  const changed = f.write('main.py', 'def main():\n    return 3\n');
  f.git('add', '.');
  f.git('commit', '--quiet', '-m', 'Task edits');
  assert.ok(f.run('PostToolUse').hookSpecificOutput);
  assert.deepEqual(f.reviewPaths(), [changed]);
});

test('an unborn repository compares source contents across its first commit', t => {
  const f = fixture(t, { committed: false });
  f.run('UserPromptSubmit');
  const changed = f.write('main.py', 'def main():\n    return 3\n');
  f.git('add', '.');
  f.git('commit', '--quiet', '-m', 'First commit');
  assert.ok(f.run('PostToolUse').hookSpecificOutput);
  assert.deepEqual(f.reviewPaths(), [changed]);
});

test('deleting a function file needs no documentation pass for that file', t => {
  const f = fixture(t);
  f.run('UserPromptSubmit');
  fs.unlinkSync(path.join(f.cwd, 'main.py'));
  assert.deepEqual(f.run('PostToolUse'), {});
});

test('parallel direct-edit receipts retain every file', async t => {
  const f = fixture(t, { repository: false });
  const files = Array.from({ length: 5 }, (_, index) => f.write(`module-${index}.py`, 'def work():\n    pass\n'));
  const results = await Promise.all(files.map((file, index) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env: f.env, windowsHide: true });
    let errors = '';
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0 && errors === '')
        resolve(JSON.parse(output));
      else
        reject(new Error(errors || `Hook exited ${code}`));
    });
    child.stdin.end(JSON.stringify(f.event('PostToolUse', {
      tool_name: 'Write', tool_use_id: `tool-${index}`, tool_input: { file_path: file },
    })));
  })));
  assert.equal(results.filter(result => result.hookSpecificOutput).length, 1);
  assert.ok(results.every(result => result.decision === undefined));
  assert.deepEqual(f.reviewPaths(), files.sort());
});

test('a legacy Stop event never requests a review even after source changes', t => {
  const f = fixture(t);
  f.run('UserPromptSubmit');
  f.write('main.py', 'def main():\n    return 3\n');
  assert.deepEqual(f.run('Stop'), {});
  assert.deepEqual(f.reviewPaths(), []);
});

test('the packaged hooks observe shell calls and register no Stop continuation', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks/hooks.json'), 'utf8')).hooks;
  assert.equal(hooks.Stop, undefined);
  const matcher = new RegExp(`^(?:${hooks.PostToolUse[0].matcher})$`);
  for (const tool of ['Bash', 'apply_patch', 'Edit', 'Write'])
    assert.ok(matcher.test(tool));
});

test('malformed events fail open with a manual-pass warning', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [script], { input: '{', encoding: 'utf8', env: f.env });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {});
  assert.match(result.stderr, /Run \$document-code manually/);
});

test('the packaged command works with spaces in plugin and data paths', t => {
  const f = fixture(t, { repository: false });
  const copiedRoot = path.join(f.cwd, 'plugin with spaces');
  fs.mkdirSync(path.join(copiedRoot, 'hooks'), { recursive: true });
  fs.copyFileSync(script, path.join(copiedRoot, 'hooks/document-code.cjs'));
  const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks/hooks.json'), 'utf8'));
  const command = hooks.hooks.UserPromptSubmit[0].hooks[0].command;
  const result = spawnSync(command, {
    shell: true, input: JSON.stringify(f.event('UserPromptSubmit')), encoding: 'utf8',
    env: { ...f.env, PLUGIN_ROOT: copiedRoot }, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {});
});
