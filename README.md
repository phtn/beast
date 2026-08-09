# Beast

A Pug(formerly Jade)-style, indentation-based language that compiles `.btsx` files to TSX.
Goal: eliminate closing tags and most angle brackets while staying a thin,
predictable layer over real TypeScript/JSX — any embedded expression is
parsed by the actual TypeScript compiler, so anything valid in TSX is valid
inside Beast.

## Setup

```bash
npm install
```

## Compile a file

```bash
npx ts-node src/index.ts examples/card.btsx examples/card.tsx \
  --props "{ user, unreadCount, messages }: { user: { name: string; id: string; isAdmin: boolean }; unreadCount: number; messages: { id: string; text: string }[] }"
```

`--props` takes the **full parameter text** (destructuring pattern + type),
so bare identifiers used in `#{...}` interpolations resolve directly. If you
omit `--props`, the generated component takes no parameters.

## Syntax

```btsx
.card
  .header
    h1 Welcome, #{user.name}
  .body
    if user.isAdmin
      AdminPanel(userId={user.id})
    else
      p You have #{unreadCount} new messages
    ul.messages
      each message, i in messages
        li.message(key={message.id}) #{message.text}
```

- **Indentation = nesting.** No closing tags.
- **`.class`** and **`#id`** shorthand; a bare `.foo` or `#bar` with no tag
  name defaults to `div`.
- **Capitalized identifier** (`AdminPanel`, `Badge`) = a component reference;
  lowercase (`div`, `h1`, `p`) = an HTML tag.
- **`tag(attr="literal" attr={expr} boolAttr)`** — attributes in parens,
  comma- or space-separated. String, `{expression}`, or bare boolean forms.
- **`#{expr}`** inline text interpolation.
- **`if` / `elseif` / `else`** — compiles to a nested ternary.
- **`each item[, index] in iterable`** — compiles to `iterable.map(...)`.
  A `key` prop is auto-injected from the loop index onto a single root
  element unless you already supplied your own `key`.
- **`| some text`** — an explicit text-only line (for text that would
  otherwise be mistaken for a tag/selector line).
- **`// comment`** — dropped entirely.

## Architecture

```
.btsx source
  → lexer.ts     (indentation-aware line splitting)
  → parser.ts    (line-by-line scanning + indent-driven tree building → ast.ts)
  → codegen.ts   (AST → real ts.JsxElement/... nodes via the TS Compiler API)
  → printer      (ts.createPrinter().printFile(...) → TSX text)
```

Embedded expressions (`#{...}`, `attr={...}`, `if`/`each` conditions) are
never hand-parsed as JS — they're handed to the real TypeScript parser via
`exprParser.ts`, which parses a throwaway `const __x = (<expr>);` statement
and extracts the initializer as a proper `ts.Expression` node. This is also
where a subtle TS printer quirk is handled: literal text (strings/numbers)
gets corrupted if a node from one source file is printed inside a tree from
another, so parsed expression trees are recursively "desynthesized" (their
position info stripped) before being spliced into the final output tree.

## Known limitations (prototype)

- No import handling — component references like `AdminPanel` are assumed to
  already be in scope; you'll want to add auto-import resolution next.
- No source maps back to the `.btsx` file.
- Attribute values only support literal/expr/boolean forms, not spread
  (`{...props}`).
- Output isn't run through `ts.formatDiagnostics`-style pretty-printing
  beyond what the TS printer gives by default — pipe it through Prettier if
  you want stable formatting.
