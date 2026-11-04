# Readable code

Before:

```js
function sendOverdueReminders(xs, n, send) {
  for (const x of xs) if (!x.paid && x.dueAtMs < n) send(x.email, x.balanceCents, Math.ceil((n - x.dueAtMs) / 86400000));
}
```

After:

```js
/**
 * Send a reminder for each unpaid invoice past its due time.
 *
 * @param {object[]} invoices - Invoice records; dueAtMs uses Unix milliseconds.
 * @param {number} nowMs - Current Unix time in milliseconds.
 * @param {Function} sendReminder - Called with (email, balanceCents, overdueDays).
 * @throws Propagates delivery failures and stops processing remaining invoices.
 */
function sendOverdueReminders(invoices, nowMs, sendReminder) {
  const millisecondsPerDay = 86_400_000;

  for (const invoice of invoices) {
    const isOverdue = !invoice.paid && invoice.dueAtMs < nowMs;
    if (!isOverdue)
      continue;

    const { email, balanceCents } = invoice;
    const overdueMs = nowMs - invoice.dueAtMs;

    // Count a partial overdue day as a full day when sending reminders.
    const overdueDays = Math.ceil(overdueMs / millisecondsPerDay);
    sendReminder(email, balanceCents, overdueDays);
  }
}
```

Two skills for code that people need to read:

- `readable-code` improves names, expressions, and control flow in selected code. It runs only when explicitly requested.
- `document-code` describes function contracts and explains complex reasoning. The Codex hook requests a final documentation pass after coding turns.

Project instructions and enforced tooling take precedence. The readability preferences include meaningful intermediate variables, separate lines for control-flow bodies, guard clauses, and helper extraction. Documentation follows the project's existing standard, with language-specific fallbacks when none is established.

## Install

The bundled hooks require Node.js 20 or newer on `PATH`. Git is needed to detect shell-based edits; direct edit tracking also works outside Git. There are no npm dependencies or separate model API calls.

### Skillshare

From a local checkout, preview and install the complete plugin:

```sh
skillshare plugin add . --plugin readable-code --target codex -g --dry-run --json
skillshare plugin add . --plugin readable-code --target codex -g --no-tui
```

After this repository is published, install from GitHub:

```sh
skillshare plugin add anthonyandrei/readable-code --plugin readable-code --target codex -g --dry-run --json
skillshare plugin add anthonyandrei/readable-code --plugin readable-code --target codex -g --no-tui
```

Use `plugin add` to keep hooks and skills together. Installing only the skill directories does not install the completion hook.

### Codex directly

From a local checkout:

```sh
codex plugin marketplace add .
codex plugin add readable-code@readable-code
```

For the published GitHub repository, replace the first command with:

```sh
codex plugin marketplace add anthonyandrei/readable-code
```

Restart or reload Codex as needed, enable the plugin, and review and trust its hooks through `/hooks`. Installation does not grant hook trust. Start a new coding turn after enabling the hooks so change tracking has a baseline.

This package uses a repository marketplace. Plugins containing lifecycle hooks are currently ineligible for the public plugin directory. See the official [plugin packaging guide](https://developers.openai.com/plugins/build/plugins) and [hook documentation](https://learn.chatgpt.com/docs/hooks).

## Use

```text
Use $readable-code on the functions changed in this task.
Use $readable-code on src/search.c, preserving its public interface.
Use $document-code to document the functions in this module.
```

With the plugin's hooks enabled, coding turns also receive one completion request to use `document-code`. The pass reviews the final implementation and treats comments written earlier in the task as drafts. Established project conventions refer to code that existed before the task. Project restrictions can place explanations in Markdown or another designated location, including notebooks that prohibit code comments and docstrings.

The skills can be used independently in other skill-capable agents. Automatic completion is implemented for Codex; other hosts need their own integration or an explicit documentation request. The skills' invocation settings use Codex's `agents/openai.yaml` convention.

## Hook behavior and limits

- `UserPromptSubmit` silently fingerprints already dirty and untracked source files. This distinguishes later edits from unrelated work that was already present.
- `PostToolUse` silently records paths from direct `Edit`, `Write`, and `apply_patch` events. Separate receipts preserve parallel edits.
- `Stop` compares the final working tree with the baseline, combines direct-edit receipts, and requests one documentation pass for source candidates. Read-only and prose-only turns stay quiet unless source changes from another process occur during the turn.

There is no `SessionStart` hook. Tracking runs locally, and candidate paths are written to a local artifact instead of injecting a file list after every edit. The skill and candidate list consume context when the final review runs. The review itself adds model work, even when it finds the documentation already complete. No fixed token overhead is guaranteed.

`Stop` is a turn-completion event. It cannot determine when an entire multi-turn project is finished. Both a persisted marker and Codex's `stop_hook_active` flag prevent repeated completion requests.

The hook only proposes paths; the agent uses task context to select the changed functions. It does not parse function bodies or certify documentation accuracy. Concurrent external edits may appear as candidates and must be excluded when unrelated.

Git fallback covers dirty, staged, and untracked files that Git reports, plus edits committed during the turn. It does not track shell-only edits outside Git, shell-only edits to Git-ignored files, files outside the session's repository, or unrecognized source extensions. Direct edit events cover recognized source files outside Git or in ignored paths. Request `$document-code` explicitly when tracking cannot cover a task. Recognized extensions are listed in `hooks/document-code.cjs`.

Hook state lives under Codex's `PLUGIN_DATA` directory. It contains local paths, content hashes, and completion markers, with separate state for each session, working directory, and turn. Source contents are not saved in that state. Tracking errors produce a warning recommending a manual pass and allow the task to finish.

Disable the plugin in Codex to stop its hooks. Installing the skills alone provides manual use without the bundled automation.

## Development

Run the focused hook checks with Node.js 20+ and Git:

```sh
node --test tests/document-code.test.cjs
```

The tests use disposable repositories and hook data directories. They do not install the plugin or modify the user's Codex configuration.

`plugin.json` is the portable manifest; `.agents/plugins/marketplace.json` exposes this repository's plugin at its root. Keep source paths inside the marketplace root and increment the manifest version when publishing an update.

## License

[MIT](LICENSE). Reuse, modification, redistribution, and sale are permitted subject to retaining the copyright and license notice.
