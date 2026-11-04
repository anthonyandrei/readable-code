# Language conventions

Use these fallbacks only when project instructions, configured tools, and pre-task conventions leave the style unspecified. Preserve the caller-oriented contract described in the skill, whichever syntax the language uses.

| Language | Default | Contract details |
| --- | --- | --- |
| Java | Javadoc | Summary, applicable `@param`, `@return`, and `@throws`. |
| C / C++ | Doxygen | `/** ... */` with summary and applicable `@param`, `@return`, `@retval`, and C++ `@throws`; explain pointer ownership and C error codes when relevant. |
| JavaScript | JSDoc | Summary and applicable `@param`, `@returns`, and `@throws`; include useful types where they are not declared elsewhere. |
| TypeScript | TSDoc-compatible comments | Summary and applicable `@param`, `@returns`, and `@throws`; keep type declarations in the signature. |
| Python | PEP 257 docstrings with Google sections | Summary and applicable `Args:`, `Returns:`, `Yields:`, and `Raises:` sections; avoid repeating type annotations. |
| Go | Go doc comments | Start with the declaration's name; describe inputs, outputs, errors, and effects in prose. |
| Rust | rustdoc `///` comments | Summary and relevant `# Errors`, `# Panics`, and `# Safety` sections. Follow the project's example and doctest conventions. |
| C# | XML documentation comments | `<summary>` and applicable `<param>`, `<returns>`, and `<exception>` elements. |
| Other languages | Established native documentation syntax | Check official language or documentation-tool guidance when unfamiliar. Keep purpose, inputs, outputs, failures, and effects readable at the declaration. |

Use `Yields` for Python generators rather than describing yielded items as a single returned collection. Describe async results according to what awaiting the function produces. Documentation syntax must remain valid for the project's toolchain.
