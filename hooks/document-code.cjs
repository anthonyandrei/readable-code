const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const sourceExtensions = new Set([
  '.astro', '.bash', '.c', '.cc', '.cjs', '.clj', '.cljs', '.cljc', '.cpp',
  '.cs', '.cxx', '.dart', '.erl', '.ex', '.exs', '.f90', '.fs', '.fsx',
  '.go', '.groovy', '.h', '.hh', '.hpp', '.hrl', '.hs', '.html', '.hxx',
  '.ipynb', '.java', '.jl', '.js', '.jsx', '.kt', '.kts', '.lua', '.m',
  '.mjs', '.ml', '.mli', '.mm', '.nim', '.php', '.pl', '.pm', '.ps1',
  '.psm1', '.py', '.pyi', '.r', '.rb', '.rs', '.scala', '.sh', '.sql',
  '.svelte', '.swift', '.ts', '.tsx', '.vue', '.zig', '.zsh',
]);

/** Produce a filename-safe identity or content fingerprint from a string or buffer. */
function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Recognize source candidates; the documentation skill decides which need edits. */
function isSource(file) {
  return sourceExtensions.has(path.extname(file).toLowerCase());
}

/** Hash an existing regular source file; return null for missing files and symlinks. */
function fingerprint(file) {
  try {
    if (!isSource(file) || !fs.lstatSync(file).isFile())
      return null;

    return digest(fs.readFileSync(file));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      return null;

    throw error;
  }
}

/** Run a bounded, read-only Git query; return null if Git or the query is unavailable. */
function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** Snapshot dirty and untracked source contents without treating pre-existing edits as new. */
function snapshot(cwd) {
  const rootOutput = git(cwd, ['rev-parse', '--show-toplevel']);
  if (rootOutput === null)
    return null;

  const root = rootOutput.replace(/\r?\n$/, '');
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
  if (status === null)
    return null;

  const files = {};
  for (const entry of status.split('\0')) {
    if (!entry)
      continue;

    const file = path.resolve(root, entry.slice(3));
    if (isSource(file))
      files[file] = fingerprint(file);
  }

  const head = git(root, ['rev-parse', '--verify', 'HEAD']);
  return { root, head: head?.trim() || null, files };
}

/** Read optional hook state; propagate invalid JSON and unexpected filesystem failures. */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT')
      return null;

    throw error;
  }
}

/** Publish complete JSON atomically so overlapping hook processes never read partial state. */
function writeJson(file, value) {
  const temporaryFile = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporaryFile, file);
}

/** Extract file paths from successful direct writes and apply_patch headers, including moves. */
function editedPaths(event) {
  const response = event.tool_response;
  if (response?.isError || response?.error || (response?.exit_code != null && response.exit_code !== 0))
    return [];

  const input = event.tool_input;
  const files = [];
  if (typeof input?.file_path === 'string')
    files.push(input.file_path);
  if (typeof input?.path === 'string')
    files.push(input.path);

  const patch = typeof input === 'string' ? input : input?.command ?? input?.patch;
  if (typeof patch === 'string') {
    for (const match of patch.matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+)\r?$/gm))
      files.push(match[1].replace(/\r$/, ''));
  }

  return files.map(file => path.resolve(event.cwd, file)).filter(isSource);
}

/** Find source contents changed since the prompt, including shell edits and in-task commits. */
function gitChanges(before, cwd) {
  if (!before)
    return [];

  const after = snapshot(cwd);
  if (!after || after.root !== before.root)
    throw new Error('Git tracking became unavailable');

  const candidates = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  if (before.head !== after.head) {
    const args = before.head
      ? ['diff', '--name-only', '-z', before.head, '--']
      : ['ls-files', '-z'];
    const committedPaths = git(after.root, args);
    if (committedPaths === null)
      throw new Error('Cannot compare task commits');

    for (const file of committedPaths.split('\0')) {
      if (file)
        candidates.add(path.resolve(after.root, file));
    }
  }

  return [...candidates].filter(file => {
    const current = fingerprint(file);
    return current !== null && current !== before.files[file];
  });
}

/**
 * Record Codex prompt baselines and source edits under PLUGIN_DATA.
 * Return PostToolUse context once per turn; other events and later edits return {}.
 * Filesystem and tracking errors propagate to main's manual-pass warning.
 */
function handleEvent(event) {
  if (!['UserPromptSubmit', 'PostToolUse'].includes(event.hook_event_name))
    return {};
  if (![event.cwd, event.session_id, event.turn_id].every(value => typeof value === 'string' && value.length > 0))
    return {};
  if (!process.env.PLUGIN_DATA)
    return {};

  const sessionKey = digest(`${event.session_id}\0${path.resolve(event.cwd)}`);
  const turnDirectory = path.join(process.env.PLUGIN_DATA, 'document-code', sessionKey, digest(event.turn_id));
  fs.mkdirSync(turnDirectory, { recursive: true, mode: 0o700 });
  const baselineFile = path.join(turnDirectory, 'baseline.json');

  if (event.hook_event_name === 'UserPromptSubmit') {
    if (!fs.existsSync(baselineFile))
      writeJson(baselineFile, { git: snapshot(event.cwd) });

    return {};
  }

  const baseline = readJson(baselineFile);
  const candidates = new Set([...editedPaths(event), ...gitChanges(baseline?.git, event.cwd)]);
  const paths = [...candidates].filter(file => fingerprint(file) !== null).sort();
  if (paths.length === 0)
    return {};

  // Keep separate receipts so parallel edits and later changes remain available at review time.
  const receiptKey = digest(event.tool_use_id || randomUUID());
  writeJson(path.join(turnDirectory, `edit-${receiptKey}.json`), paths);
  const requestedFile = path.join(turnDirectory, 'review-requested');
  try {
    fs.closeSync(fs.openSync(requestedFile, 'wx', 0o600));
  } catch (error) {
    if (error.code === 'EEXIST')
      return {};

    throw error;
  }

  const skillFile = path.resolve(__dirname, '../skills/document-code/SKILL.md');
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: 'Before your final response, finish implementation and validation, then perform one final '
        + `documentation pass using the skill at ${JSON.stringify(skillFile)}. `
        + `At review time, read the candidate path arrays in edit-*.json under ${JSON.stringify(turnDirectory)}. `
        + 'Use the final task diff and context to select surviving task-related functions, including later changes. '
        + 'Summarize the work and documentation together in one final response. '
        + 'If this pass already ran and the implementation has not changed since, finish without repeating it.',
    },
  };
}

/** Consume Codex's JSON event; report tracking failures without blocking the coding task. */
function main() {
  try {
    const event = JSON.parse(fs.readFileSync(0, 'utf8'));
    process.stdout.write(JSON.stringify(handleEvent(event)));
  } catch {
    process.stderr.write('[document-code] Tracking failed. Run $document-code manually for this task.\n');
    process.stdout.write('{}');
  }
}

main();
