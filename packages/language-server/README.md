# Beast Language Server

Language Server Protocol support for Beast (`.btsx`) components.

## Features

- Beast compiler diagnostics
- Beast keyword, HTML tag, attribute, component, and prop completions
- Relative import-path completion
- Component auto-import edits
- Go to definition for imports and components
- Import document links
- Component references across a workspace

## Run

```sh
beast-language-server --stdio
```

The initial release is Beast-aware. TypeScript expression semantics will be
added after BTSX-to-TSRX source mappings can translate positions reliably.
