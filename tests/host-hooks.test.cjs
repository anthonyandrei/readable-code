const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('Claude prompt IDs and plugin data produce a reminder after a write', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readable-host-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.resolve(__dirname, '../hooks/document-code.cjs');
  const file = path.join(root, 'example.js');
  const common = { cwd: root, session_id: 'session', prompt_id: 'prompt' };
  const run = (event) => {
    const result = spawnSync(process.execPath, [script], { input: JSON.stringify(event), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: root } });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(run({ ...common, hook_event_name: 'UserPromptSubmit' }), {});
  fs.writeFileSync(file, 'const x = 1;');
  const result = run({ ...common, hook_event_name: 'PostToolUse', tool_input: { file_path: file } });
  assert.match(result.hookSpecificOutput.additionalContext, /documentation pass/);
});

test('Antigravity receives a documentation reminder at model invocation', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../hooks/antigravity.cjs')], { input: '{}', encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).injectSteps[0].ephemeralMessage, /document-code/);
});
