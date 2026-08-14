import { describe, expect, test } from "bun:test";
import * as behavior from "octane/behavior";
import * as hydration from "octane/hydration";
import * as octane from "octane";
import * as server from "octane/server";
import * as staticRenderer from "octane/static";

const PUBLIC_CORE_API = [
  {
    entry: "octane",
    exports: octane,
    names: [
      "Activity",
      "Children",
      "ErrorBoundary",
      "Fragment",
      "Hydrate",
      "Suspense",
      "ViewTransition",
      "ViewTransitionPseudoElement",
      "act",
      "addTransitionType",
      "attachBehaviorRoot",
      "cloneElement",
      "createContext",
      "createElement",
      "createPortal",
      "createRoot",
      "flushSync",
      "hydrateRoot",
      "initializeHydrationEventCapture",
      "isChildrenBlock",
      "isValidElement",
      "lazy",
      "memo",
      "preconnect",
      "prefetchDNS",
      "preinit",
      "preinitModule",
      "preload",
      "preloadModule",
      "requestFormReset",
      "startTransition",
      "use",
      "useActionState",
      "useCallback",
      "useContext",
      "useDebugValue",
      "useDeferredValue",
      "useEffect",
      "useEffectEvent",
      "useFormStatus",
      "useId",
      "useImperativeHandle",
      "useInsertionEffect",
      "useLayoutEffect",
      "useLinkedState",
      "useMemo",
      "useOptimistic",
      "useReducer",
      "useRef",
      "useState",
      "useSyncExternalStore",
      "useTransition",
      "version",
    ],
  },
  {
    entry: "octane/hydration",
    exports: hydration,
    names: [
      "condition",
      "idle",
      "initializeHydrationEventCapture",
      "interaction",
      "load",
      "media",
      "never",
      "visible",
    ],
  },
  {
    entry: "octane/behavior",
    exports: behavior,
    names: ["attachBehaviorRoot"],
  },
  {
    entry: "octane/server",
    exports: server,
    names: [
      "getSsrSuspenseTimeout",
      "renderToPipeableStream",
      "renderToReadableStream",
      "renderToStaticMarkup",
      "renderToString",
      "setSsrSuspenseTimeout",
    ],
  },
  {
    entry: "octane/static",
    exports: staticRenderer,
    names: ["prerender", "prerenderToNodeStream"],
  },
] as const;

describe("Octane public Core API inventory", () => {
  test.each(PUBLIC_CORE_API as unknown as Array<[typeof PUBLIC_CORE_API[number]]>)("$entry exposes every tracked API", ({ exports, names }: { exports: Record<string, unknown>; names: readonly string[] }) => {
    const missing = names.filter((name: string) => !(name in exports));
    expect(missing).toEqual([]);
  });
});
