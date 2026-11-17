# ast-grep

Use `ast-grep` for code searches that need syntax or structure. Keep text search
for plain-text queries the user explicitly asks for.

The CLI is installed (`ast-grep` 0.51.3, with a deprecated `sg` alias). Two skills
are installed: `ast-grep` for rule writing and `ast-grep-outline` for a cheap
structural map before reading full source. Invoke them by name when the task
matches.

Basic form:

```
ast-grep --lang <language> -p '<pattern>'
```

Set `--lang` to the language under search, for example `typescript` for this
repository's `.ts` files. A pattern must be a complete syntax node. Use
meta-variables `$VAR` for captured nodes and `$$$` for variadic nodes.

## Rule development

For rules beyond a one-line pattern, follow this loop:

1. Break the query into smaller parts.
2. Identify sub-rules that match each part.
3. Combine them with relational or composite rules.
4. If the rule does not match the example, remove sub-rules and debug the part
   that fails.
5. Dump the AST or the pattern query to see what the matcher sees.
6. Test the rule against a concrete example before applying it.

Prefer the highest seam: match the call site or declaration, not an internal
statement that will move. A rule that only works against one file layout is a
bad rule.

## Documentation

The full documentation is available as an LLM-oriented text file at
https://ast-grep.github.io/llms-full.txt. Load it when writing a complex rule;
it is the authoritative source for rule syntax and reduces invented patterns.
The MCP server (`ast-grep-mcp`) is not installed; add it only if dedicated
iterative rule development becomes a recurring task.
