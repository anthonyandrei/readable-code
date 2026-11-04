---
name: document-code
description: Document functions and explain complex reasoning after completing code changes. Use for a final documentation pass on code created or modified in a coding task, or when documentation is explicitly requested.
---

# Document code

Document the finished implementation so a reader can follow the caller without opening every helper. For an automatic completion pass, review only functions created or changed in the current task, including private helpers. An explicit request may select a wider scope. Candidate paths supplied by a hook are hints; use the task history and diff to exclude unrelated edits, generated files, and vendor code.

## Choose the standard

Resolve the documentation style in this order:

1. Project instructions and restrictions, including where explanations may appear.
2. Configured documentation tools and conventions established before this task.
3. The language defaults in [language conventions](references/languages.md), reading only the relevant entry. For an unfamiliar language or tool, consult its official documentation.

Treat comments and docstrings added during this task as drafts. They do not establish a new project convention. Review them against the finished code and the standard selected above; update stale descriptions and inconsistent formatting.

When a project prohibits comments or docstrings in code, put permitted explanations in its designated prose location. For notebooks, use Markdown cells if allowed. Respect cell and word limits. Avoid moving explanations into docstrings or helper functions to bypass a restriction. If no explanation location is allowed, leave the code compliant and report the limitation.

## Describe the contract

Give every named function in scope a short purpose summary, even when private. Document the following where they affect the caller:

- Parameter meanings and constraints, including units, valid ranges, defaults, and nullability.
- Return meaning, including sentinel values and empty results.
- Exceptions, error returns, and other failure conditions that callers must handle.
- Side effects, mutation, I/O, ownership, and resource responsibilities.

Keep simple summaries short. Describe semantics beyond the names and declared types. Omit empty sections, tautological parameter descriptions, and speculative failures that the implementation or API contract does not support. Include relevant propagated failures, without enumerating every theoretical runtime exception.

Use inline comments to explain non-obvious decisions, invariants, constraints, or unfamiliar mathematics. Prefer clear names for ordinary operations. Place comments next to the logic they explain, and remove comments that no longer match the implementation.

## Final pass

Read each changed function's final implementation and check its callers as needed to verify the contract. Revise earlier documentation for accuracy and a consistent style. Keep this pass to documentation; surface behavior changes as separate work. Run the existing documentation, formatting, or syntax checks relevant to the edits, especially where docstrings have runtime effects.

Finish when every named function in scope has an accurate summary, applicable contract details are covered, and project restrictions are satisfied. Perform one completion pass per coding turn. If it already ran and the implementation has not changed since, hand off without repeating it. Read-only turns need no documentation edits.
