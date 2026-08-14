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
| Portals | A module helper passes a tagless local component and its props through `createPortal` while preserving logical event ancestry | `portal` golden, SSR placeholder assertion, and executable cross-container lifecycle |
| Actions and forms | `useActionState` owns submission state, `useFormStatus` reads it below the form, `useOptimistic` stages a row, and `requestFormReset` resets after success | `actions` golden and SSR assertion |
| Conditions | `if`, `elseif`, and `else` emit native `@if` arms | `card`, `status` goldens |
| Keyed lists | Item/index bindings, explicit keys, and single-root key hoisting emit `@for` | `card`, `catalog`, `status` goldens |
| Empty lists | An aligned `empty` branch emits native `@empty` | `catalog` golden |
| Multi-way branches | `switch`, `case`, and `default` emit native `@switch` arms | `variant` golden |
| Async/error boundaries | `try`, `pending`, and bound `catch` emit native boundary arms | `boundary` golden |
| Runtime boundary components | `lazy` composes under `Suspense` and `ErrorBoundary`; Promise reads prove fulfilled, pending, and rejected server paths; `Activity` covers visible/hidden/prerender output | `deferred`, `async` goldens and async SSR assertions |
| Deferred hydration | Every activation strategy, dynamic selection, strategy/procedural prefetch, fallback/completion props, default child extraction, permanent-static ranges, server markers, and idempotent early event capture | `hydration` golden, extracted-child compile, SSR assertions, and capture test |
| Library and resources | Element creation/cloning, descriptor and children-block checks, all five `Children` methods, six resource/connection APIs, transition pseudo-element handles, and package version | `library` golden and SSR assertions plus pseudo-element/version runtime test |
| Fragments and text holes | Explicit and automatic output fragments, text-only lines, escaping, and interpolation | `fragment`, `styling` goldens |
| Context | Module-scoped `createContext`, dotted `Theme.Provider`, and local `use()`/`useContext()` consumers | `provider` golden |
| Client ownership | Root mount/update/unmount, server-DOM adoption, dormant-boundary activation and event replay, synchronous/test scheduling, cross-container portals, and non-reconciling behavior ownership | Executable Happy DOM lifecycle suite |
| Server and static rendering | Hydratable/static buffered output, scoped CSS/head channels, Node and Web progressive streams, await-everything output, aborts, deadlines, and complete Node preludes | Executable renderer lifecycle suite |
| Public entry points | Every tracked name is present in the pinned `octane`, hydration, behavior, server, and static module namespaces | Machine-readable Core API inventory test |
| Client bundling | Mixed BTSX/TSRX Vite application production build | project integration test |

Every golden output is compared byte for byte and compiled with the pinned
Octane compiler. The focused lifecycle suites execute the non-template entry
points, while a machine-readable inventory guards every tracked public export.

## Public Core API ledger

This ledger is the completion contract for Beast's Core API conformance work.
It follows Octane's official [Core APIs] index, the hydration strategies taught
on that page, and the public rendering functions from `octane/server` and
`octane/static` in the pinned `octane@0.1.37` types. Compiler-emitted runtime
helpers, metaframework RPC internals, compatibility aliases, and type-only
exports are outside this user-facing scope.

| Area | API | Status | Proof |
| --- | --- | --- | --- |
| State | `useState` | Covered | `counter`, `responsive`, and `transitions` goldens |
| State | `useReducer` | Covered | `hooks` initialized reducer, latest-state getter lowering, and SSR assertion |
| State | `useLinkedState` | Covered | `editor` golden |
| Context | `createContext`, `use(context)`, `useContext` | Covered | `provider` golden |
| Async data | `use(Promise)` | Covered | `async` fulfilled, Suspense-pending, and ErrorBoundary-rejected SSR assertions |
| External state | `useSyncExternalStore` | Covered | `network` golden and SSR assertion |
| Refs/effects | `useRef`, `useEffect` | Covered | `refs`, `shortcut`, and `counter` goldens |
| Refs/effects | `useLayoutEffect`, `useInsertionEffect`, `useEffectEvent` | Covered | `hooks` client lowering and server no-effect assertion |
| Refs/effects | `useId`, `useImperativeHandle` | Covered | `hooks` linked SSR ID and server-inert handle assertion |
| Loading | `Suspense`, `ErrorBoundary`, `lazy` | Covered | `deferred` golden and client/server compilation |
| Loading | `startTransition`, `useTransition`, `useDeferredValue` | Covered | `responsive` and `transitions` goldens with SSR |
| Loading | `Activity` | Covered | `async` visible/hidden/prerender client lowering and SSR assertions |
| Hydration | `Hydrate` | Covered | `hydration` complete prop surface, default extracted child, and permanent-static lowering |
| Hydration | `load`, `idle`, `visible`, `media`, `interaction`, `condition`, `never` | Covered | `hydration` client compile and server marker assertions for every strategy plus dynamic factory |
| Hydration | `initializeHydrationEventCapture` | Covered | Per-document capture listener idempotence test |
| Actions | `useActionState`, `useFormStatus`, `useOptimistic`, `requestFormReset` | Covered | `actions` golden and SSR assertion |
| Composition | `Fragment` | Covered | Automatic output in `fragment` and explicit source fragment in `styling` |
| Composition | `memo`, `useCallback` | Covered | `hooks` memoized local summary and stable dispatch callback |
| Composition | `useMemo` | Covered | `counter` golden |
| Composition | `createPortal` | Covered | `portal` golden, SSR placeholder assertion, cross-container mount/unmount, and logical event bubbling |
| View transitions | `ViewTransition`, `addTransitionType` | Covered | `transitions` golden and client/server assertions |
| View transitions | `ViewTransitionPseudoElement` | Covered | Selector, `animate()`, and filtered `getAnimations()` runtime assertions |
| Roots | `createRoot` | Covered | Executable mount, state update, same-component prop update, and unmount lifecycle |
| Roots | `hydrateRoot` | Covered | Server-rendered node adoption, effect activation, event update, and unmount lifecycle |
| Behavior roots | `attachBehaviorRoot` | Covered | Root/focused-entry parity plus externally owned range gating, adoption, events, cleanup, and DOM-preserving disposal |
| Resources | `preload`, `preinit`, `preloadModule`, `preinitModule` | Covered | `library` client passthrough, server head emission, and dedupe assertions |
| Resources | `preconnect`, `prefetchDNS` | Covered | `library` server head assertions |
| Descriptors | `createElement`, `cloneElement` | Covered | `library` mapped and single cloned-descriptor SSR assertions |
| Inspection | `isValidElement`, `isChildrenBlock`, `Children` | Covered | `library` traversal counts, flattened/mapped output, `only`, and compiled children-block assertion |
| Scheduling/testing | `flushSync`, `act` | Covered | Synchronous DOM commit plus render/effect settling in the client lifecycle suite |
| Debugging | `useDebugValue` | Covered | `hooks` client/server lowering assertion |
| Package | `version` | Covered | Runtime export equals Beast's pinned Octane dependency |
| Server | `renderToString` | Covered | Hydratable markers, suspense seeds, nonce, folded/separate head channels, and existing SSR assertions |
| Server | `renderToStaticMarkup` | Covered | Marker-free static output plus scoped CSS channel and CSP nonce assertions |
| Server | `renderToPipeableStream`, `renderToReadableStream` | Covered | Node `pipe`/callbacks and Web `allReady` assertions with progressive Suspense output |
| Server | `setSsrSuspenseTimeout`, `getSsrSuspenseTimeout` | Covered | Global getter/setter, per-render override, timeout, and abort assertions |
| Static | `prerender`, `prerenderToNodeStream` | Covered | Await-everything buffered result and complete Node prelude assertions |

Every public Core API row is now `Covered`. This means its committed example or
lifecycle test is documented and passes the repository's release checks; it
does not claim coverage for compiler-private helpers or metaframework internals.
The inventory test also fails if any tracked name disappears from its pinned
public entry point.

## Next additions

### 1. Close application-integration gaps

The Vite path has client production coverage, but still needs full lifecycle
fixtures for server transforms, rendering, hydration, and compiler-split
deferred hydration.
After that, add Beast adapters or documented precompile workflows for Octane's
Rspack and Rsbuild integrations. Framework-specific adapters should follow
only when the core bundler contracts are stable.

### 2. Improve compiler tooling

Add Beast-to-TSRX source maps and a standalone watch mode. These are not Octane
runtime capabilities, but they are required for complete diagnostics and a
non-Vite development workflow.

## Recommended order

The smallest dependency-aware sequence is:

1. Rspack/Rsbuild integration and SSR/deferred-split application lifecycles.
2. Source maps and standalone watch mode.

[Quick start]: https://octanejs.dev/docs
[Core APIs]: https://octanejs.dev/docs/core-apis
[TSRX vs TSX/JSX]: https://octanejs.dev/docs/tsrx-vs-tsx
[Differences from React]: https://octanejs.dev/docs/differences-from-react
[Build tools]: https://octanejs.dev/docs/build-tools
