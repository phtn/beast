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
| Components, typed props, children | Native elements, component references, source imports, typed props, and tagless local component declarations | `app`, `provider` goldens |
| Setup and hooks | Inline TypeScript setup; `useState`, `useMemo`, and `useEffect` compile through Octane | `counter` golden |
| Advanced hooks | Initialized reducer/current-state getter, insertion/layout phases, effect events, generated IDs, imperative handles, stable callbacks, memoized components, and debug labels | `hooks` golden, client lowering assertions, and SSR assertion |
| Module/setup source | Inline and multiline raw TypeScript, module directives, comments, blank lines, refs, and effect cleanup | `shortcut` golden |
| Refs | Object refs, callback refs with cleanup, and arrays of refs pass through as ordinary props | `refs`, `shortcut` goldens |
| Native events and attributes | Expression, string, boolean, spread, ARIA, data, class, ID, native `onInput`, and form events, with authored spread precedence | `catalog`, `counter`, `editor`, `styling` goldens |
| Element composition and CSS | Explicit and automatic fragments plus raw, component-scoped style blocks with `:global()` escapes | `fragment`, `styling` goldens and styling SSR assertion |
| Linked controlled state | Strong-mode `useLinkedState` reconciles editable state by source identity | `editor` golden |
| External stores | Stable subscription/client snapshot functions and a deterministic server snapshot pass through `useSyncExternalStore` | `network` golden and SSR assertion |
| Responsive updates | `useTransition` marks tab changes as non-urgent while `useDeferredValue` lets search results lag behind controlled input | `responsive` golden and SSR assertion |
| View transitions | `ViewTransition` receives named enter/exit/update classes while `addTransitionType` selects a directional class map inside `startTransition` | `transitions` golden, client preload assertion, and SSR annotation assertion |
| Portals | A module helper passes a tagless local component and its props through `createPortal` while preserving logical event ancestry | `portal` golden and SSR placeholder assertion |
| Actions and forms | `useActionState` owns submission state, `useFormStatus` reads it below the form, `useOptimistic` stages a row, and `requestFormReset` resets after success | `actions` golden and SSR assertion |
| Conditions | `if`, `elseif`, and `else` emit native `@if` arms | `card`, `status` goldens |
| Keyed lists | Item/index bindings, explicit keys, and single-root key hoisting emit `@for` | `card`, `catalog`, `status` goldens |
| Empty lists | An aligned `empty` branch emits native `@empty` | `catalog` golden |
| Multi-way branches | `switch`, `case`, and `default` emit native `@switch` arms | `variant` golden |
| Async/error boundaries | `try`, `pending`, and bound `catch` emit native boundary arms | `boundary` golden |
| Runtime boundary components | `lazy` composes under `Suspense` and `ErrorBoundary`; visibility-triggered `Hydrate` defers interactivity with eager child code | `deferred` golden |
| Fragments and text holes | Explicit and automatic output fragments, text-only lines, escaping, and interpolation | `fragment`, `styling` goldens |
| Context | Module-scoped `createContext`, dotted `Theme.Provider`, and local `use()`/`useContext()` consumers | `provider` golden |
| Client bundling | Mixed BTSX/TSRX Vite application production build | project integration test |

Every golden output is compared byte for byte and compiled with the pinned
Octane compiler. Runtime APIs not named above are generally *expressible* but
do not yet have a focused Beast example or integration test.

## Public Core API ledger

This ledger is the completion contract for Beast's Core API conformance work.
It follows Octane's official [Core APIs] index, the hydration strategies taught
on that page, and the public rendering functions from `octane/server` and
`octane/static` in the pinned `octane@0.1.37` types. Compiler-emitted runtime
helpers, metaframework RPC internals, compatibility aliases, and type-only
exports are outside this user-facing scope.

| Area | API | Status | Current proof or next fixture |
| --- | --- | --- | --- |
| State | `useState` | Covered | `counter`, `responsive`, and `transitions` goldens |
| State | `useReducer` | Covered | `hooks` initialized reducer, latest-state getter lowering, and SSR assertion |
| State | `useLinkedState` | Covered | `editor` golden |
| Context | `createContext`, `use(context)`, `useContext` | Covered | `provider` golden |
| Async data | `use(Promise)` | Planned | Suspense success/fallback server assertions |
| External state | `useSyncExternalStore` | Covered | `network` golden and SSR assertion |
| Refs/effects | `useRef`, `useEffect` | Covered | `refs`, `shortcut`, and `counter` goldens |
| Refs/effects | `useLayoutEffect`, `useInsertionEffect`, `useEffectEvent` | Covered | `hooks` client lowering and server no-effect assertion |
| Refs/effects | `useId`, `useImperativeHandle` | Covered | `hooks` linked SSR ID and server-inert handle assertion |
| Loading | `Suspense`, `ErrorBoundary`, `lazy` | Covered | `deferred` golden and client/server compilation |
| Loading | `startTransition`, `useTransition`, `useDeferredValue` | Covered | `responsive` and `transitions` goldens with SSR |
| Loading | `Activity` | Planned | Visible/hidden/prerender compilation and SSR fixture |
| Hydration | `Hydrate` | Partial | `deferred` covers `visible`, `fallback`, and `split={false}` |
| Hydration | `load`, `idle`, `visible`, `media`, `interaction`, `condition`, `never` | Partial | `visible` covered; remaining strategies planned |
| Hydration | `initializeHydrationEventCapture` | Planned | Client lifecycle fixture |
| Actions | `useActionState`, `useFormStatus`, `useOptimistic`, `requestFormReset` | Covered | `actions` golden and SSR assertion |
| Composition | `Fragment` | Covered | Automatic output in `fragment` and explicit source fragment in `styling` |
| Composition | `memo`, `useCallback` | Covered | `hooks` memoized local summary and stable dispatch callback |
| Composition | `useMemo` | Covered | `counter` golden |
| Composition | `createPortal` | Covered | `portal` golden and SSR placeholder assertion |
| View transitions | `ViewTransition`, `addTransitionType` | Covered | `transitions` golden and client/server assertions |
| View transitions | `ViewTransitionPseudoElement` | Planned | Typed callback and pseudo-element animation fixture |
| Roots | `createRoot` | Partial | Creator template and Vite production build |
| Roots | `hydrateRoot` | Planned | Full SSR-to-hydration lifecycle fixture |
| Behavior roots | `attachBehaviorRoot` | Planned | Existing-DOM ownership and disposal fixture |
| Resources | `preload`, `preinit`, `preloadModule`, `preinitModule` | Planned | Resource-hint client/server fixture |
| Resources | `preconnect`, `prefetchDNS` | Planned | Connection-hint client/server fixture |
| Descriptors | `createElement`, `cloneElement` | Planned | Descriptor composition fixture |
| Inspection | `isValidElement`, `isChildrenBlock`, `Children` | Planned | Library helper fixture |
| Scheduling/testing | `flushSync`, `act` | Planned | Client root lifecycle fixture |
| Debugging | `useDebugValue` | Covered | `hooks` client/server lowering assertion |
| Package | `version` | Planned | Public export assertion |
| Server | `renderToString` | Covered | Multiple executable server assertions |
| Server | `renderToStaticMarkup` | Planned | Buffered renderer parity fixture |
| Server | `renderToPipeableStream`, `renderToReadableStream` | Planned | Node and Web stream assertions |
| Server | `setSsrSuspenseTimeout`, `getSsrSuspenseTimeout` | Planned | Scoped timeout configuration assertion |
| Static | `prerender`, `prerenderToNodeStream` | Planned | Await-everything buffered and stream assertions |

`Partial` means the API already passes through Beast, but the complete public
shape described in the Core APIs guide is not yet proven. A row moves to
`Covered` only after its committed example or lifecycle test is documented and
passes the repository's release checks.

## Next additions

### 1. Complete async and visibility APIs

Add focused fixtures for promise-valued `use()` and every `Activity` mode, then
compose both with Suspense and hydration where their visible server behavior
can be asserted.

### 2. Complete deferred-hydration coverage

Exercise every hydration strategy, the complete `Hydrate` prop surface,
permanently static ranges, and early interaction capture. Then add a full
server-render and client-hydration fixture, including compiler-split children.

### 3. Cover library and resource helpers

Exercise descriptors, Children inspection, resource hints, view-transition
pseudo-elements, and the public package version with direct assertions for
every export.

### 4. Close client ownership and rendering gaps

Cover `createRoot`, `hydrateRoot`, `flushSync`, `act`, portals, and behavior-only
roots in executable DOM lifecycle tests rather than compilation-only examples.

### 5. Complete server and static rendering

Exercise buffered, Node-stream, Web-stream, await-everything, static, and
Suspense-timeout entry points against Beast-compiled components.

### 6. Close application-integration gaps

The Vite path has client production coverage, but still needs full lifecycle
fixtures for server transforms, rendering, hydration, and compiler-split
deferred hydration.
After that, add Beast adapters or documented precompile workflows for Octane's
Rspack and Rsbuild integrations. Framework-specific adapters should follow
only when the core bundler contracts are stable.

### 7. Improve compiler tooling

Add Beast-to-TSRX source maps and a standalone watch mode. These are not Octane
runtime capabilities, but they are required for complete diagnostics and a
non-Vite development workflow.

## Recommended order

The smallest dependency-aware sequence is:

1. Promise `use()`, Activity, and complete deferred hydration.
2. Resources, descriptors, inspection helpers, view-transition pseudo-elements,
   and package metadata.
3. Client ownership, roots, and behavior-only roots.
4. Server/static rendering APIs.
5. Rspack/Rsbuild support, source maps, and standalone watch mode.

[Quick start]: https://octanejs.dev/docs
[Core APIs]: https://octanejs.dev/docs/core-apis
[TSRX vs TSX/JSX]: https://octanejs.dev/docs/tsrx-vs-tsx
[Differences from React]: https://octanejs.dev/docs/differences-from-react
[Build tools]: https://octanejs.dev/docs/build-tools
