# Octane coverage map

This map compares Beast with Octane's official [Quick start], [Core APIs],
[TSRX vs TSX/JSX], [Differences from React], and [Build tools] documentation.
It tracks three different concerns separately:

- **Authoring syntax**: whether BTSX can express the documented TSRX shape.
- **Runtime passthrough**: whether normal imports, setup statements,
  attributes, and component tags can use an Octane API without Beast-specific
  syntax.
- **Integration coverage**: whether the repository proves the behavior in a
  complete build or server lifecycle.

Beast does not need a special grammar feature for every Octane API. Most hooks
and components are TypeScript calls or component references, and should pass
through `import`, `setup`, attributes, and nesting unchanged.

## Covered today

| Octane area | Beast coverage | Proof |
| --- | --- | --- |
| Components, typed props, children | Native elements, component references, source imports and typed props | `app`, `provider` goldens |
| Setup and hooks | One-line TypeScript setup statements; `useState`, `useMemo`, and `useEffect` compile through Octane | `counter` golden |
| Native events and attributes | Expression, string, boolean, ARIA, data, class, ID, and event attributes | `catalog`, `counter` goldens |
| Conditions | `if`, `elseif`, and `else` emit native `@if` arms | `card`, `status` goldens |
| Keyed lists | Item/index bindings, explicit keys, and single-root key hoisting emit `@for` | `card`, `catalog`, `status` goldens |
| Empty lists | An aligned `empty` branch emits native `@empty` | `catalog` golden |
| Multi-way branches | `switch`, `case`, and `default` emit native `@switch` arms | `variant` golden |
| Fragments and text holes | Automatic output fragments, text-only lines, escaping, and interpolation | `fragment` golden |
| Context-style component APIs | Dotted PascalCase component tags such as `Theme.Provider` are preserved | `provider` golden |
| Client bundling | Mixed BTSX/TSRX Vite application production build | project integration test |

Every golden output is compared byte for byte and compiled with the pinned
Octane compiler. Runtime APIs not named above are generally *expressible* but
do not yet have a focused Beast example or integration test.

## Next additions

### 1. Finish native TSRX directive coverage

Add BTSX nodes and diagnostics for `try`, `pending`, and `catch` →
`@try`/`@pending`/`@catch`.

These are the remaining prominent output directives in Octane's introductory
TSRX documentation. Async boundary syntax should include catch bindings and
validate arm ordering and adjacency.

### 2. Make source regions multiline

Replace the one-line-only source declaration constraint with explicit
multiline module and setup blocks. This unlocks readable effect cleanup,
reducers, callbacks, local helpers, context creation, and module-level
`"use strong"` without compressing TypeScript onto one line.

The design must keep indentation unambiguous: source blocks should be clearly
delimited rather than guessed from template-shaped TypeScript.

### 3. Complete element-level TSRX syntax

Add spread attributes, an explicit source fragment form, and raw/scoped style
blocks. Spread attributes are especially useful for wrapper components and for
covering Octane's development-time native text-event checks when final host
props are dynamic.

### 4. Expand runtime conformance examples

These do not generally need new BTSX grammar after multiline setup exists:

- Native controlled input with `onInput` and `useLinkedState`.
- `useRef`, callback refs, and an effect with cleanup.
- `use()`/`useContext` with a provider and consumer.
- `Suspense`, `ErrorBoundary`, `lazy`, and `Hydrate` component composition.
- `useSyncExternalStore`, transitions/actions, deferred values, view
  transitions, and portals.

Keep examples focused: one golden per distinct compiler shape, with Octane
runtime tests only where compilation cannot prove the behavior.

### 5. Close application-integration gaps

The Vite path has client production coverage, but still needs full lifecycle
fixtures for server transforms, rendering, hydration, and deferred hydration.
After that, add Beast adapters or documented precompile workflows for Octane's
Rspack and Rsbuild integrations. Framework-specific adapters should follow
only when the core bundler contracts are stable.

### 6. Improve compiler tooling

Add Beast-to-TSRX source maps and a standalone watch mode. These are not Octane
runtime capabilities, but they are required for complete diagnostics and a
non-Vite development workflow.

## Recommended order

The smallest dependency-aware sequence is:

1. `@try`/`@pending`/`@catch`.
2. Multiline module/setup blocks and module directives.
3. Form, ref/effect, context-consumer, and async-boundary goldens.
4. Spread attributes, explicit fragments, and style blocks.
5. Vite SSR/hydration integration fixtures.
6. Rspack/Rsbuild support, source maps, and standalone watch mode.

[Quick start]: https://octanejs.dev/docs
[Core APIs]: https://octanejs.dev/docs/core-apis
[TSRX vs TSX/JSX]: https://octanejs.dev/docs/tsrx-vs-tsx
[Differences from React]: https://octanejs.dev/docs/differences-from-react
[Build tools]: https://octanejs.dev/docs/build-tools
