---
name: readable-code
description: Improve the readability of selected code while preserving its behavior. Apply only when explicitly requested.
---

# Readable code

Make the requested code easy to follow from its entry point. Keep the pass within the selected files, functions, or diff; use the current task's changes when no narrower scope is given. Preserve behavior and public interfaces. Follow project rules and enforced formatting before the preferences below.

## Names and expressions

- Give variables and functions precise names that describe their role. Include units where they prevent ambiguity, such as `elapsed_seconds`; prefer `vector_dim` to `dim` when several dimensions are involved.
- Extract complex call arguments into meaningful local variables: calculations, pointer arithmetic, nested lookups, and multi-step transformations. Keep simple field access, addresses, and familiar expressions such as `sizeof(value)` inline when already clear.
- Preserve evaluation order, short-circuiting, side effects, lifetimes, and ownership when extracting expressions. Introduce a value at the point where it was originally evaluated.
- Replace compressed expressions with explicit control flow when a reader would need to decode them. Avoid temporary variables that merely rename an obvious value.

For example, in C:

```c
const char *title = corpus->titles[results[result_index].index];
print_title(title);
```

## Flow and spacing

- Put each `if`, `else if`, `else`, or loop body on a separate indented line from its condition or header. Expand single-line suites in languages such as Python too.
- Where the language permits, braces are optional for a simple single-statement body. Use braces for multiple statements, nested control flow, or a body whose explanation needs a comment. If any branch of an `if` chain needs braces, brace the whole chain.
- Use guard clauses and early returns to reduce nesting when cleanup and error handling remain correct.
- Separate meaningful stages with blank lines. Keep statements that form one operation together.
- Extract a helper when it names a coherent operation and makes the caller easier to read. Keep simple logic local; avoid spreading one operation across many tiny helpers.

Use names and structure to explain what happens. Add inline comments for reasoning, constraints, or unfamiliar algorithms that the code cannot communicate on its own. Respect projects that place explanations outside code. A readability pass does not authorize architecture changes, public API renames, or unrelated refactoring.

Finish by reviewing the diff for behavioral changes and running the relevant existing checks. Report the scope and any uncertainty about preserving behavior.
