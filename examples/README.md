# Beast examples

Every example directory contains a `.btsx` source file and its generated
`.tsrx` golden output. The test suite compares each pair byte for byte and
compiles every golden through Octane.

These are focused compiler fixtures, not standalone applications. Use
`create-beast` when you want a runnable Vite project. The example sources and
goldens are also included in the published `beast-tsrx` package.

| Example | Demonstrates |
| --- | --- |
| [`app`](app/app.btsx) | Source imports, typed props, component composition, IDs, and dynamic classes |
| [`boundary`](boundary/boundary.btsx) | Async `try`, `pending`, and bound `catch` output |
| [`card`](card/card.btsx) | Nested elements, interpolation, conditions, and a hoisted loop key |
| [`catalog`](catalog/catalog.btsx) | Attributes, explicit loop keys, and an `empty` fallback |
| [`counter`](counter/counter.btsx) | `useState`, inferred-dependency `useMemo` and `useEffect`, and state-driven events |
| [`deferred`](deferred/deferred.btsx) | `lazy` under `Suspense`/`ErrorBoundary` plus visibility-triggered `Hydrate` composition |
| [`editor`](editor/editor.btsx) | Strong-mode `useLinkedState`, controlled text input, native `onInput`, and form submission |
| [`fragment`](fragment/fragment.btsx) | Multiple roots, text-only lines, comments, escaping, and interpolation |
| [`network`](network/network.btsx) | Stable browser subscription and deterministic SSR with `useSyncExternalStore` |
| [`provider`](provider/provider.btsx) | Module-scoped Context, dotted provider, and `use()`/`useContext()` consumers |
| [`refs`](refs/refs.btsx) | An object ref plus callback ref array and callback cleanup |
| [`shortcut`](shortcut/shortcut.btsx) | Multiline module/setup source, Strong mode, `useRef`, and effect cleanup |
| [`status`](status/status.btsx) | Nested loops plus `elseif` and `else` branches |
| [`variant`](variant/variant.btsx) | Multi-way `switch`, `case`, and `default` output |

Compile one example directly:

```bash
bun src/cli.ts compile examples/catalog/catalog.btsx \
  --output /tmp/catalog.tsrx
```

When adding an example, use the same basename for both files. Example
directories are discovered automatically by the conformance suite.

The `deferred` fixture also contains `analytics.tsrx`, the native TSRX module
loaded by its `lazy()` component.
