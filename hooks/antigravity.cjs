const fs = require('node:fs');

// Remind the agent on each invocation so later edits remain in scope.
try {
  JSON.parse(fs.readFileSync(0, 'utf8'));
  process.stdout.write(JSON.stringify({
    injectSteps: [{ ephemeralMessage: 'When this task creates or changes code, finish implementation and validation, then use the document-code skill for a final documentation pass before responding.' }],
  }));
} catch {
  process.stdout.write('{}');
}
