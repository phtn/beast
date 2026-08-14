<!-- markdownlint-disable MD013 -->

# Beast

> An indentation-first component language that compiles BTSX into native TSRX
> for Octane.

[![Status: Alpha](https://img.shields.io/badge/status-alpha-d97706?style=flat-square)](#project-status)
[![Version](https://img.shields.io/badge/version-0.1.0-6f42c1?style=flat-square)](package.json)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.22.2-339933?style=flat-square&logo=nodedotjs&logoColor=white)](package.json)
[![Octane](https://img.shields.io/badge/Octane-0.1.37-111827?style=flat-square)](https://octanejs.dev/)
[![License: ISC](https://img.shields.io/badge/license-ISC-0f766e?style=flat-square)](LICENSE)

**Write the structure. Keep the types. Let Octane own rendering.**

[Quick start](#quick-start) ·
[How it works](#how-it-works) ·
[Language reference](#language-reference) ·
[Examples](examples/README.md) ·
[Octane coverage](docs/octane-coverage.md) ·
[CLI reference](#cli-reference) ·
[Vite integration](#vite-integration) ·
[Development](#development)

---

Beast is a small, source-located compiler for authoring
[TSRX](https://tsrx.dev/) components with indentation instead of closing tags.
It turns `.btsx` files into readable `.tsrx`, preserves native Octane template
control flow, and integrates with [Octane](https://octanejs.dev/) and
[Vite](https://vite.dev/) for application builds.

Beast does not replace TypeScript, TSRX, Octane, or Vite. It owns the compact
authoring layer and hands generated TSRX to the existing toolchain for final
validation, lowering, development serving, and production bundling.

## At a glance

| Capability | What it does | Why it matters |
| --- | --- | --- |
| BTSX compiler | Converts indentation-based `.btsx` into native `.tsrx` | Keeps generated output inspectable |
| Component setup | Emits local TypeScript and Octane hooks before the template root | Keeps stateful components self-contained |
| Native control flow | Emits Octane condition, loop, switch, and boundary directives | Preserves TSRX semantics and identity |
| Project builder | Recursively compiles BTSX and validates native TSRX | Supports mixed source trees |
| Vite integration | Runs Beast before Octane in memory | Enables normal dev and production builds |
| Diagnostics | Reports stable codes with file and source spans | Makes compiler failures actionable |
| Project creator | Scaffolds a typed Beast, Octane, and Vite application | Provides a coherent starting point |

## Quick start

Create a project with Bun:

```bash
bun create beast@latest
```

Pass a directory to skip the prompt:

```bash
bun create beast@latest my-app
cd my-app
bun run dev
```

The equivalent direct package-executor form is:

```bash
bun x create-beast@latest my-app
```

The generated project includes:

- Beast and Octane configured as one Vite compilation pipeline
- A typed `App.btsx` component
- TSRX-aware TypeScript checking through `tsrx-tsc`
- Development, production build, preview, type-check, and combined check scripts
- A focused `.gitignore` and an optional initialized Git repository

Creator options:

| Option | Effect |
| --- | --- |
| `--no-install` | Write the project without running `bun install` |
| `--no-git` | Skip `git init` |
| `--force` | Write known template files into a non-empty directory without deleting unrelated files |
| `-h`, `--help` | Print command help |

## How it works

```mermaid
flowchart LR
    A[.btsx source] --> B[Indentation-aware parser]
    B --> C[Source-located Beast AST]
    C --> D[TSRX generator]
    D --> E[.tsrx source]
    E --> F[Octane compiler]
    F --> G[Vite module graph]
    G --> H[Browser application]
```

Beast deliberately generates native TSRX rather than TSX-shaped intermediate
code. Conditions and loops remain template operations, component output stays
readable, and Octane remains the authority for TSRX syntax and runtime
compilation.

Given this BTSX:

```btsx
import AdminPanel from "./AdminPanel.btsx";
props { user, unreadCount, messages }: { user: { name: string; id: string; isAdmin: boolean }; unreadCount: number; messages: { id: string; text: string }[] }

.card
  .header
    h1 Welcome, #{user.name}
  .body
    if user.isAdmin
      AdminPanel(userId={user.id})
    else
      p You have #{unreadCount} new messages
    ul.messages
      each message, i in messages key message.id
        li.message #{message.text}
```

Beast produces this TSRX shape:

```tsrx
import AdminPanel from "./AdminPanel.btsx";

export default function Card({
	user,
	unreadCount,
	messages,
}: {
	user: { name: string; id: string; isAdmin: boolean };
	unreadCount: number;
	messages: { id: string; text: string }[];
}) @{
	<div className="card">
		<div className="header">
			<h1>Welcome, {user.name}</h1>
		</div>
		<div className="body">
			@if (user.isAdmin) {
				<AdminPanel userId={user.id} />
			} @else {
				<p>You have {unreadCount} new messages</p>
			}
			<ul className="messages">
				@for (const message of messages; index i; key message.id) {
					<li className="message">{message.text}</li>
				}
			</ul>
		</div>
	</div>
}
```

The CLI and project builder validate generated TSRX with Octane by default.
Validation can be disabled for constrained compiler-only environments, but it
should remain enabled in normal development and release workflows.

## Language reference

### Elements and nesting

Indentation defines the template tree. Indentation must use spaces; tabs are
rejected with a source-located diagnostic.

```btsx
main.page
  section#intro.hero
    h1 Beast
    p Indentation becomes structure.
```

Selectors follow a compact CSS-like form:

| BTSX | Meaning |
| --- | --- |
| `section` | HTML element |
| `Card` | Component reference |
| `Theme.Provider` | Dotted component reference |
| `.card` | `div` with class `card` |
| `section.hero` | `section` with class `hero` |
| `section#intro.hero` | `section` with ID `intro` and class `hero` |

Capitalized tag names are treated as component references. Referenced
components can be imported at the top of the BTSX file or otherwise be in
scope in the eventual TSRX module. PascalCase or `_`/`$` segments after a
capitalized tag are preserved as a dotted component API, so `Theme.Provider`
emits `<Theme.Provider>`. A lowercase dotted suffix remains class shorthand:
`Card.featured` emits `<Card className="featured">`.

### Module code, imports, local components, props, and setup

Top-level `module`, `import`, `component`, `props`, and `setup` declarations
make a component self-contained. They must appear before the first template
node. Imports and props occupy one physical line; module and setup source can
be inline or use an indented block.

```btsx
import UserCard from "./UserCard.btsx";
import type { User } from "./types.ts";
props { user, compact = false }: { user: User; compact?: boolean }

UserCard(user={user} compact={compact})
```

Imports are copied into generated TSRX in source order. Beast stores their
contents as source slices and lets Octane perform final TypeScript syntax
validation. A component may have one `props` declaration; its contents are the
complete typed function parameter, with an optional trailing semicolon.
Explicit `propsParam` options in the CLI, programmatic API, project builder, or
Vite plugin override the source declaration.

`module` emits TypeScript at module scope. Use it for directives, types,
context values, constants, and helper functions. A module directive such as
`"use strong"` must remain before imports, just as it would in native TSRX:

```btsx
module
  "use strong";
  const shortcutKey = "/";

import { useEffect, useRef } from "octane";
```

The `component` declaration defines a local component using the same tagless
BTSX syntax as the default component. Its optional `props` and `setup`
declarations must precede its template. This keeps module-scoped Context and
its consumers self-contained without embedding TSRX tags in BTSX:

```btsx
import { createContext, use } from "octane";
module
  interface ThemeProviderProps { theme: string }
  const Theme = createContext("light");

component ThemeLabel
  setup const currentTheme = use(Theme);
  p #{"Current theme: " + currentTheme}
props { theme }: ThemeProviderProps

Theme.Provider(value={theme})
  ThemeLabel
```

`use(Theme)` and `useContext(Theme)` both pass through unchanged. See the
complete [provider golden](examples/provider/provider.btsx), which exercises
both readers below a dotted provider.

`setup` emits TypeScript inside the component's `@{ ... }` body before its
rendered root. This is where local values and Octane hooks live. The inline
form holds one statement; the block form holds multiline source such as an
effect with cleanup:

```btsx
import { useEffect, useMemo, useState } from "octane";
props { initialCount, onCountChange }: { initialCount: number; onCountChange: (count: number) => void }
setup const [count, setCount] = useState(initialCount);
setup const doubled = useMemo(() => count * 2);
setup useEffect(() => onCountChange(count));

button(type="button" onClick={() => setCount(count + 1)}) Count: #{count}, doubled: #{doubled}
```

Dependency arguments are intentionally omitted in this example so Octane can
infer them from each closure. See the complete [counter golden](examples/counter/counter.btsx).

For editable state that follows a changing source, use Octane's
`useLinkedState`. Text fields use the browser-native `onInput` event for each
edit:

```btsx
module "use strong";
import { useLinkedState } from "octane";
props { user }: { user: { id: string; name: string } }
setup const [name, setName] = useLinkedState(user.id, () => user.name);

input(value={name} onInput={(event) => setName(event.currentTarget.value)})
```

This keeps local edits while `user.id` is unchanged and reconciles immediately
when the source changes. See the complete [editor golden](examples/editor/editor.btsx).

Indented source blocks end at the next nonblank line aligned with the
declaration. Beast removes their common source indentation while preserving
relative indentation, comments, and blank lines. It does not parse or rewrite
the TypeScript; Octane performs final syntax validation and hook lowering. See
the multiline [shortcut golden](examples/shortcut/shortcut.btsx).

Refs are ordinary expression attributes. Octane accepts object refs, callback
refs with optional cleanup, and nested arrays combining either form:

```btsx
import { useRef } from "octane";
setup
  const inputRef = useRef<HTMLInputElement | null>(null);
  const reportInput = (element: HTMLInputElement | null) => {
    onAttach(element);
    if (element !== null) return () => onAttach(null);
  };

input(ref={[inputRef, reportInput]})
```

The same `ref={...}` attribute can be passed to a component that declares a
ref prop; Beast does not require or insert a forwarding wrapper. See the
complete [refs golden](examples/refs/refs.btsx).

For state already owned outside Octane, keep subscription and snapshot
functions stable at module scope, then call `useSyncExternalStore` from setup.
Its third argument provides a deterministic server snapshot:

```btsx
import { useSyncExternalStore } from "octane";
module
  function subscribe(onStoreChange: () => void) {
    window.addEventListener("online", onStoreChange);
    return () => window.removeEventListener("online", onStoreChange);
  }
  function getSnapshot() { return navigator.onLine; }
  function getServerSnapshot() { return true; }
setup const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

p(role="status") #{isOnline ? "Online" : "Offline"}
```

The complete [network golden](examples/network/network.btsx) subscribes to both
browser connectivity events and cleans them up. Its conformance test also
executes the server-compiled component, proving SSR uses `getServerSnapshot`
without reading browser globals.

Responsive updates use normal setup hooks as well. Keep controlled input state
urgent, pass a deferred copy to slower output, and reserve transitions for
updates where the current screen remains useful:

```btsx
import { useDeferredValue, useState, useTransition } from "octane";
setup const [tab, setTab] = useState("overview");
setup const [isPending, startTransition] = useTransition();
setup const [query, setQuery] = useState("");
setup const deferredQuery = useDeferredValue(query);

button(onClick={() => startTransition(() => setTab("activity"))}) #{isPending ? "Opening…" : "Activity"}
input(value={query} onInput={(event) => setQuery(event.currentTarget.value)})
SearchResults(query={deferredQuery})
```

`useDeferredValue` is not a debounce; it controls which render may lag rather
than imposing a fixed delay. See the complete
[responsive golden](examples/responsive/responsive.btsx).

View transitions wrap the DOM region whose visual state should animate. Start
the update as a transition, and use `addTransitionType` when one boundary needs
different classes for different navigation directions:

```btsx
import { ViewTransition, addTransitionType, startTransition, useState } from "octane";
module type Tab = "overview" | "activity";
setup const [tab, setTab] = useState<Tab>("overview");
setup
  const selectTab = (next: Tab) => {
    startTransition(() => {
      addTransitionType(next === "activity" ? "forward" : "backward");
      setTab(next);
    });
  };

button(onClick={() => selectTab("activity")}) Activity
ViewTransition(name="project-panel" update={{ default: "panel-update", forward: "slide-left", backward: "slide-right" }})
  article #{tab === "overview" ? "Overview" : "Activity"}
```

Beast preserves the boundary, callbacks, and class maps as native Octane
component props. The complete
[transitions golden](examples/transitions/transitions.btsx) also covers enter
and exit classes, typed navigation state, Octane's client preload hint, and
server transition annotations.

Portals use a normal module helper that returns `createPortal`. A tagless local
component can be passed as the portal body, so BTSX does not need to embed a
TSRX fragment inside the call:

```btsx
import { createPortal } from "octane";
module
  interface SavedToastProps { target: HTMLElement; onDismiss: () => void }
  function SavedToast({ target, onDismiss }: SavedToastProps) {
    return createPortal(ToastBody, target, { onDismiss });
  }

component ToastBody
  props { onDismiss }: { onDismiss: () => void }
  aside.toast
    p(role="status") Draft saved.
    button(type="button" onClick={onDismiss}) Dismiss
props { target, onDismiss }: SavedToastProps

SavedToast(target={target} onDismiss={onDismiss})
```

The optional third argument supplies props to the portal body. The complete
[portal golden](examples/portal/portal.btsx) keeps the physical overlay under
its logical Beast parent so Octane can preserve context and event ancestry.

Form actions can combine action-owned state, descendant status, optimistic
output, and an uncontrolled-field reset. The optimistic update belongs inside
the action, while `useFormStatus` belongs in a component rendered beneath the
form:

```btsx
import { requestFormReset, useActionState, useFormStatus, useOptimistic, useRef } from "octane";
module
  interface EditNameProps {
    names: readonly string[];
    saveName: (name: string) => Promise<void>;
  }

component SubmitButton
  setup const { pending } = useFormStatus();
  button(type="submit" disabled={pending}) #{pending ? "Saving…" : "Save"}
props { names, saveName }: EditNameProps
setup
  const formRef = useRef<HTMLFormElement | null>(null);
  const [optimisticNames, addOptimisticName] = useOptimistic(names, (current, name: string) => [...current, name]);
  const [message, submit] = useActionState(async (_previous: string, data: FormData) => {
    const name = String(data.get("name") ?? "").trim();
    if (!name) return "Enter a name before saving.";
    addOptimisticName(name);
    await saveName(name);
    if (formRef.current !== null) requestFormReset(formRef.current);
    return "Saved " + name + ".";
  }, "Save a name.");

form(ref={formRef} action={submit})
  input(name="name" defaultValue="Ada")
  SubmitButton
p #{message}
```

The complete [actions golden](examples/actions/actions.btsx) also validates
empty input, exposes the pending form data to its submit button, and renders
the optimistic collection.

### Attributes

Attributes live in parentheses and may be separated by spaces or commas:

```btsx
Button(tone="primary" count={items.length} disabled) Continue
```

| Form | Output behavior |
| --- | --- |
| `name="value"` | Quoted string attribute |
| `name='value'` | Single-quoted string attribute |
| `name={expression}` | TypeScript expression attribute |
| `disabled` | Boolean attribute |

`class` is normalized to `className`. Selector shorthand and an explicit class
are combined; conflicting ID declarations and duplicate explicit class
attributes are rejected.

### Text and interpolation

Inline text follows an element selector. Use `#{...}` to embed an expression:

```btsx
p Hello, #{user.name}. You have #{messages.length} messages.
```

Use a pipe for a line that should be interpreted only as text:

```btsx
div.notice
  | This line is text, not an element selector.
```

Literal text is escaped in generated TSRX. Embedded expressions remain source
slices and receive their final syntax validation from Octane.

### Conditions

`if`, `elseif`, and `else` compile directly to native `@if` control flow:

```btsx
if status === "ready"
  ReadyView
elseif status === "loading"
  LoadingView
else
  ErrorView
```

Branches must be adjacent and aligned at the same indentation level. Orphaned,
empty, duplicate, or post-`else` branches produce compiler diagnostics.

### Iteration and keys

Loops compile directly to native `@for` blocks:

```btsx
each item in items
  li #{item.label}

each item, index in items key item.id
  Row(item={item} position={index})

each result in results key result.id
  SearchResult(result={result})
empty
  p No matches.
```

The supported header is:

```text
each item[, index] in iterable [key expression]
```

For compatibility, a `key={expression}` attribute on a loop's single root
element is hoisted into the generated `@for` header. Beast never invents an
index key: keys affect keyed rendering and hook identity, so they must be
authored deliberately.

An aligned `empty` branch immediately after a loop compiles to Octane's native
`@empty` arm. It must contain at least one template node.

### Multiple choices

`switch`, `case`, and `default` compile to Octane's native `@switch` control
flow. Arms are isolated and do not use `break`:

```btsx
switch status
  case "ready"
    ReadyView
  case "loading"
    LoadingView
  default
    ErrorView
```

The switch expression and every case expression remain TypeScript source
slices for Octane to validate. Arms must be indented directly beneath their
switch, contain at least one template node, and include no more than one
`default`. A default arm is optional.

### Loading and error boundaries

`try` may be followed by `pending`, `catch`, or both. These compile directly to
Octane's `@try`/`@pending`/`@catch` template boundaries:

```btsx
try
  Profile(data={profileData})
pending
  p Loading profile…
catch error, reset
  .error
    p Could not load profile: #{String(error)}
    button(type="button" onClick={reset}) Try again
```

When both continuations are present, `pending` must come before `catch`. Catch
bindings may be omitted, written directly after `catch`, or surrounded by one
optional pair of parentheses. Their TypeScript binding syntax is preserved for
Octane to validate. Every authored boundary arm must contain at least one
template node.

Octane's component boundaries and hydration strategies compose through normal
imports, attributes, and nesting. A lazy component suspends into the nearest
`Suspense`; a rejected load reaches the nearest `ErrorBoundary`. `Hydrate`
keeps server-rendered content dormant until its strategy opens:

```btsx
import { ErrorBoundary, Hydrate, Suspense, lazy } from "octane";
import { visible } from "octane/hydration";
module const LazyAnalytics = lazy(() => import("./analytics.tsrx"));

ErrorBoundary(fallback="The dashboard could not be loaded.")
  Suspense(fallback="Loading analytics…")
    LazyAnalytics(reportId={reportId})
  Hydrate(when={visible({ rootMargin: "400px" })} split={false})
    ReviewSummary(reportId={reportId})
```

This focused form opts out of Hydrate's child-chunk extraction while still
deferring interactivity. Compiler-split Hydrate boundaries belong in a full
SSR/hydration bundler lifecycle. See the complete
[deferred golden](examples/deferred/deferred.btsx).

### Comments and roots

Lines beginning with `//` are omitted from output. A component with multiple
root nodes, no root node, or a text-only root is wrapped in a TSRX fragment.

## CLI reference

After installing `beast-tsrx`, the `beast` binary supports single-component
compilation and recursive source-tree builds.

```text
beast compile <input.btsx> [options]
beast <input.btsx> [output.tsrx] [options]
beast build [source-directory] [options]
beast --help
```

### Compile a component

```bash
beast compile src/Card.btsx \
  --output generated/Card.tsrx \
  --component-name Card \
  --props '{ title }: { title: string }'
```

| Option | Description | Default |
| --- | --- | --- |
| `-o`, `--output PATH` | Write TSRX to a specific path | Input path with `.tsrx` extension |
| `--component-name NAME` | Override the generated component identifier | Derived from the filename |
| `--props PARAMETER` | Override the complete function parameter, including its type | Source declaration or empty parameter list |
| `--no-validate` | Skip Octane validation | Validation enabled |

The output path must differ from the input path. Parent directories are
created as needed.

### Build a source tree

```bash
beast build ./src --out-dir ./.beast
```

| Argument or option | Description | Default |
| --- | --- | --- |
| `source-directory` | Root recursively searched for `.btsx` and `.tsrx` | Current directory |
| `--out-dir PATH` | Mirrored destination for generated TSRX | `<source-directory>/.beast` |
| `--no-validate` | Skip validation of generated and native TSRX | Validation enabled |

The builder ignores `.git`, `.beast`, `build`, `coverage`, `dist`, and
`node_modules`. Discovery and manifest entries are sorted for deterministic
output.

Each build writes `beast-manifest.json` with the generated source path, output
path, component name, and validated native TSRX files. Native `.tsrx` files are
validated in place; they are not copied into the output directory.

After all current inputs compile and validate, Beast removes outputs recorded
by the previous manifest that are no longer generated. Cleanup accepts only
canonical `.tsrx` paths inside the output directory, skips symlinked parent
directories, prunes directories only when they become empty, and never removes
untracked files. Removed paths are returned as `result.removed` and reported by
the CLI.

The project builder does not replace an application bundler. Octane and Vite
remain responsible for producing a deployable application.

## Vite integration

Use `beastOctane()` for projects containing Beast and native TSRX modules:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { beastOctane } from "beast-tsrx/vite";

export default defineConfig({
  plugins: [
    beastOctane({
      octane: {
        strong: true,
      },
    }),
  ],
});
```

Then import both source types normally:

```ts
import App from "./App.btsx";
import { NativePanel } from "./NativePanel.tsrx";
```

The Beast pre-transform generates TSRX in memory and passes it to Octane's
public bundler compiler. Native `.tsrx` modules go through Octane's direct Vite
integration. HMR invalidation is forwarded for `.btsx` changes, and SSR
transforms select Octane's server environment.

The `components` option remains available for per-file `componentName` and
`propsParam` overrides. Source-level props are preferred when a component owns
its public parameter type.

`beast()` is also exported for advanced configurations that only need the
BTSX pre-transform. Most applications should use `beastOctane()` exactly once.

## Programmatic API

### Compile source

```ts
import { compileBeast, compileBeastResult } from "beast-tsrx";

const code = compileBeast(source, {
  filename: "Card.btsx",
  componentName: "Card",
  propsParam: "{ title }: { title: string }",
});

const result = compileBeastResult(source, {
  filename: "Card.btsx",
});

console.log(result.ast, result.code, result.diagnostics);
```

### Build a project

```ts
import { buildBeastProject } from "beast-tsrx";

const result = await buildBeastProject({
  root: "src",
  outDir: ".beast",
  components: {
    "components/Card.btsx": {
      componentName: "Card",
      propsParam: "{ title }: { title: string }",
    },
  },
});

console.log(result.manifestPath, result.removed);
```

Component configuration keys are POSIX-style paths relative to the project
root. The same shape is accepted by the Vite integration.

### Exports

| Export | Purpose |
| --- | --- |
| `compileBeast()` | Compile BTSX source and return TSRX code |
| `compileBeastResult()` | Return generated code, the source-located AST, and diagnostics |
| `parse()` | Parse BTSX into the public Beast AST |
| `componentNameFromPath()` | Derive and sanitize a component identifier from a path |
| `buildBeastProject()` | Compile and validate a recursive source tree |
| `resolveProjectPath()` | Resolve project-relative configuration paths |
| `BeastCompileError` | Structured compiler error carrying a stable diagnostic |
| `formatDiagnostic()` | Render a diagnostic with source location and caret context |
| `beast()` | Vite pre-transform for BTSX modules |
| `beastOctane()` | Complete Vite integration for mixed BTSX and TSRX projects |

Vite exports are available from `beast-tsrx/vite`; compiler and project exports
are available from `beast-tsrx`.

## Diagnostics

Parser and generator failures throw `BeastCompileError`. Each diagnostic
contains:

- A stable `BEAST####_*` code
- `error` or `warning` severity
- A human-readable message
- The source filename
- Start and end offsets, lines, and columns
- An optional remediation hint

The CLI renders the failing source line with a caret marker. Syntax that Beast
stores as embedded TypeScript source receives its final language-level
validation from Octane.

## Compatibility

| Tool | Supported version | Role |
| --- | --- | --- |
| Node.js | `>=22.22.2` | Required by the supported Octane toolchain |
| Bun | Current stable | Workspace, tests, project creation, and dependency installation |
| TypeScript | `^5.9.3` | Package declarations and generated-project checking |
| TSRX TypeScript plugin | `0.3.118` | `.tsrx` and `.btsx` project type checking |
| Octane | `0.1.37` | TSRX validation, lowering, and runtime |
| Vite | `^8.0.16` | Development server and production bundling |

Octane and TSRX are evolving. Beast pins the versions used by its conformance
suite and starter project so failures are reproducible.

## Correctness contract

The current suite and release checks verify the behavior Beast claims publicly:

- BTSX fixtures must match committed TSRX output byte for byte.
- Every golden TSRX fixture must compile through Octane without diagnostics.
- Recursive builds must mirror paths, emit a versioned manifest, and safely
  remove only stale outputs tracked by the previous manifest.
- Mixed `.btsx` and native `.tsrx` applications must complete a production
  Vite build.
- The project creator must preserve unrelated files, refuse accidental writes
  to non-empty directories, and generate the expected toolchain configuration.
- Packed `beast-tsrx` and `create-beast` artifacts must install into a clean
  project whose type check and production build succeed.

These checks protect the current contract. They do not imply production
stability while Beast, Octane, and TSRX remain alpha-stage software.

## Repository structure

```text
beast/
├── src/
│   ├── ast.ts                   # Public source-located Beast AST
│   ├── parser.ts                # Indentation-aware BTSX parser
│   ├── codegen.ts               # Beast AST to native TSRX
│   ├── compiler.ts              # Public compilation entry points
│   ├── diagnostics.ts           # Structured errors and formatting
│   ├── project.ts               # Recursive source-tree builder
│   ├── vite.ts                  # Beast and Octane Vite integration
│   └── cli.ts                   # `beast` command-line adapter
├── packages/create-beast/
│   ├── src/index.ts             # Project creator CLI and API
│   ├── template/                # Vite, Octane, TSRX, and BTSX starter
│   └── tests/create.test.ts      # Creator safety and output tests
├── examples/
│   ├── README.md                # Example index and usage notes
│   ├── actions/                 # Form actions, optimistic state, and reset
│   ├── app/                     # Imports and component composition
│   ├── boundary/                # Loading and error template boundaries
│   ├── card/                    # Conditions and a hoisted loop key
│   ├── catalog/                 # Attributes and an explicit loop key
│   ├── counter/                 # Octane state, memo, and effect hooks
│   ├── deferred/                # Lazy boundaries and deferred hydration
│   ├── editor/                  # Linked controlled input and native events
│   ├── fragment/                # Multiple roots, text, and escaping
│   ├── network/                 # External-store subscription and SSR snapshot
│   ├── portal/                  # Cross-container rendering and logical ancestry
│   ├── provider/                # Context provider and consumer hooks
│   ├── refs/                    # Callback, object, and array refs
│   ├── responsive/              # Transitions and deferred search output
│   ├── shortcut/                # Multiline source and effect cleanup
│   ├── status/                  # Nested loops and branch chains
│   ├── transitions/             # View-transition classes and typed directions
│   └── variant/                 # Multi-way switch output
├── docs/
│   └── octane-coverage.md       # Official-doc coverage map and roadmap
├── tests/
│   ├── compiler.test.ts         # Compiler and Octane conformance tests
│   └── project.test.ts          # Project builder and Vite tests
├── package.json                 # `beast-tsrx` package and workspace root
└── tsconfig.json
```

## Development

Requirements: Node.js 22.22.2 or newer and Bun.

```bash
git clone https://github.com/phtn/beast.git
cd beast
bun install --frozen-lockfile
bun run check
```

| Script | Purpose |
| --- | --- |
| `bun run build` | Compile both publishable workspace packages |
| `bun run typecheck` | Type-check both packages without emitting files |
| `bun run test` | Run compiler, builder, Vite, and creator tests |
| `bun run check` | Run type checking, tests, and builds in sequence |
| `bun run pack:check` | Inspect both npm package tarballs without publishing |

When changing the language or generator:

1. Update the parser, AST, or generator at the smallest appropriate layer.
2. Add or revise a paired `.btsx` and `.tsrx` golden fixture when output changes.
3. Add diagnostic coverage for invalid syntax and ambiguous constructs.
4. Run `bun run check` and both package dry runs.
5. Confirm generated TSRX remains readable and valid through Octane.

Focused issues and pull requests are welcome. Changes should preserve
deterministic output, explicit keys, source-located failures, and the boundary
between Beast authoring syntax and Octane compilation.

## Project status

Beast is an alpha compiler with a deliberately narrow initial language. The
minimum compiler, recursive builder, Vite integration, and project creator are
working and tested; the language and public API may still change before a
stable release.

Current limitations:

- The CLI builder has no per-file configuration file; use the programmatic API
  or Vite component options.
- Spread attributes, explicit source fragments, and raw style blocks are not
  exposed in BTSX.
- Beast-to-TSRX source maps are not implemented. Vite currently returns
  Octane's map for the generated TSRX layer.
- Standalone watch mode is not implemented; Vite owns watched application
  builds.
- Embedded expressions are preserved as source slices rather than parsed into
  a TypeScript expression AST by Beast.
- Tab indentation is intentionally unsupported.

See the [golden example index](examples/README.md) for focused BTSX inputs and
the exact generated TSRX output contract. The living
[Octane coverage map](docs/octane-coverage.md) separates supported runtime APIs
from BTSX syntax and integration work that still remains. Its public Core API
ledger is synced to the official API index and the pinned Octane types, and a
capability is marked covered only after its example or lifecycle test passes
the release checks.

## License

Released under the [ISC License](LICENSE).

---

*A compact authoring layer for explicit, native Octane templates.*
