const assert = require('node:assert/strict');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const test = require('node:test');

const pluginRoot = path.resolve(__dirname, '..');
const codex = process.env.CODEX_TEST_BINARY || 'codex';

test('Codex discovers both skills and all three hooks after installation', { timeout: 30_000 }, async (t) => {
  const version = spawnSync(codex, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (version.error?.code === 'ENOENT') {
    t.skip('Codex CLI is not installed');
    return;
  }
  assert.equal(version.status, 0, version.stderr || String(version.error));

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'readable-code-install-'));
  const env = { ...process.env, CODEX_HOME: home };
  let server;
  t.after(async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'close');
      server.stdin.end();
      await exited;
    }
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  // Install into an isolated Codex home; never trust or execute the bundled hooks.
  for (const args of [
    ['plugin', 'marketplace', 'add', pluginRoot, '--json'],
    ['plugin', 'add', 'readable-code@readable-code', '--json'],
  ]) {
    execFileSync(codex, args, { env, cwd: home, windowsHide: true, stdio: 'pipe' });
  }

  server = spawn(codex, ['app-server', '--stdio'], {
    env, cwd: home, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = readline.createInterface({ input: server.stdout });
  t.after(() => lines.close());

  const detail = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('exit', () => reject(new Error('Codex exited before returning plugin details')));
    lines.on('line', (line) => {
      const response = JSON.parse(line);
      if (response.error) {
        reject(new Error(JSON.stringify(response.error)));
        return;
      }
      if (response.id === 1) {
        server.stdin.write(`${JSON.stringify({
          id: 2, method: 'plugin/read', params: {
            pluginName: 'readable-code',
            marketplacePath: path.join(pluginRoot, '.agents/plugins/marketplace.json'),
          },
        })}\n`);
      }
      if (response.id === 2)
        resolve(response.result.plugin);
    });
    server.stdin.write(`${JSON.stringify({
      id: 1, method: 'initialize', params: {
        clientInfo: { name: 'readable-code-install-test', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      },
    })}\n`);
  });

  assert.equal(detail.summary.installed, true);
  assert.equal(detail.summary.enabled, true);
  assert.deepEqual(detail.skills.map((skill) => skill.name).sort(), [
    'readable-code:document-code', 'readable-code:readable-code',
  ]);
  assert.deepEqual(detail.hooks.map((hook) => hook.eventName).sort(), [
    'postToolUse', 'stop', 'userPromptSubmit',
  ]);
});
