import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { version, ViewTransitionPseudoElement } from 'octane'
import { compile } from 'octane/compiler'
import { initializeHydrationEventCapture } from 'octane/hydration'
import { renderToString } from 'octane/server'
import { eachMapping, originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import { BeastCompileError, compileBeast, compileBeastResult, componentNameFromPath } from '../src/index.js'
import { composeSourceMaps } from '../src/source-map.js'

function getCompileError(source: string, filename = 'Invalid.btsx'): BeastCompileError {
  try {
    compileBeast(source, { filename })
  } catch (error) {
    if (error instanceof BeastCompileError) return error
    throw error
  }
  throw new Error('Expected Beast compilation to fail.')
}

async function renderCompiledServer(code: string, props?: unknown): Promise<string> {
  return (await renderCompiledServerResult(code, props)).html
}

async function renderCompiledServerResult(code: string, props?: unknown) {
  let executable = code
  for (const specifier of ['octane/server', 'octane/hydration']) {
    const resolved = JSON.stringify(import.meta.resolve(specifier))
    executable = executable.replaceAll(JSON.stringify(specifier), resolved).replaceAll(`'${specifier}'`, resolved)
  }
  if (executable === code) throw new Error('Expected an Octane server runtime import.')

  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'beast-server-test-'))
  const modulePath = resolve(temporaryDirectory, 'component.mjs')
  try {
    await writeFile(modulePath, executable, 'utf8')
    const compiled = (await import(pathToFileURL(modulePath).href)) as {
      default: Parameters<typeof renderToString>[0]
    }
    return renderToString(compiled.default, props)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

const GOLDEN_FIXTURES = (await readdir(resolve('examples'), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

describe('BTSX to TSRX', () => {
  test.each(GOLDEN_FIXTURES)('matches the %s golden fixture', async (fixture) => {
    const directory = resolve('examples', fixture)
    const filename = resolve(directory, `${fixture}.btsx`)
    const source = await readFile(filename, 'utf8')
    const expected = await readFile(resolve(directory, `${fixture}.tsrx`), 'utf8')
    const actual = compileBeast(source, { filename })
    expect(actual).toBe(expected)
    const octane = compile(actual, filename.replace(/\.btsx$/u, '.tsrx'), {
      mode: 'client',
      hmr: false
    })
    expect(octane.diagnostics).toHaveLength(0)
    expect(octane.code.length).toBeGreaterThan(0)
  })

  test('supports explicit Octane loop keys', () => {
    const output = compileBeast('each item, i in items key item.id\n  li #{item.name}\n', {
      filename: 'List.btsx'
    })
    expect(output).toContain('@for (const item of items; index i; key item.id)')
  })

  test('preserves spread attributes and their authored precedence', () => {
    const result = compileBeastResult(
      'button.primary(type="button" {...defaults} class={className} {...overrides}) Continue\n',
      { filename: 'SpreadButton.btsx' }
    )

    expect(result.code).toContain(
      '<button type="button" {...defaults} className={[className, "primary"].filter(Boolean).join(" ")} {...overrides}>'
    )
    const button = result.ast.children[0]
    expect(button?.kind).toBe('element')
    if (button?.kind === 'element') {
      expect(button.attrs).toMatchObject([
        { kind: 'attribute', name: 'type', value: { type: 'string', value: 'button' } },
        { kind: 'spread', code: 'defaults' },
        { kind: 'attribute', name: 'class', value: { type: 'expr', code: 'className' } },
        { kind: 'spread', code: 'overrides' }
      ])
    }
  })

  test('maps generated TSRX nodes and attributes back to BTSX', () => {
    const filename = '/project/src/App.btsx'
    const source = [
      'import { useState } from "octane";',
      'props { title }: { title: string }',
      'main.app(role="main")',
      '  h1 #{title}',
      '  if title',
      '    span Yes',
      '  else',
      '    span No'
    ].join('\n') + '\n'
    const result = compileBeastResult(source, { filename })
    const map = new TraceMap(result.map)

    expect(result.map).toMatchObject({
      version: 3,
      file: '/project/src/App.tsrx',
      sources: [filename],
      sourcesContent: [source],
      names: []
    })
    expect(originalPositionFor(map, { line: 4, column: 23 })).toMatchObject({
      source: filename,
      line: 3,
      column: 9
    })
    expect(originalPositionFor(map, { line: 5, column: 2 })).toMatchObject({
      source: filename,
      line: 4,
      column: 2
    })
    expect(originalPositionFor(map, { line: 8, column: 4 })).toMatchObject({
      source: filename,
      line: 7,
      column: 2
    })
  })

  test('composes Octane output locations through generated TSRX to BTSX', () => {
    const filename = '/project/src/App.btsx'
    const source = [
      'import { useState } from "octane";',
      'props { title }: { title: string }',
      'main',
      '  h1 #{title}'
    ].join('\n') + '\n'
    const beast = compileBeastResult(source, { filename })
    const octane = compile(beast.code, '/project/src/App.tsrx', {
      mode: 'client',
      hmr: false
    })
    const composed = composeSourceMaps(octane.map, beast.map)
    if (composed === null) throw new Error('Expected Octane to emit a source map.')

    const mappings: Array<{ source: string | null; originalLine: number | null }> = []
    eachMapping(new TraceMap(composed), (mapping) => mappings.push(mapping))
    expect(composed.sources).toEqual([filename])
    expect(composed.sourcesContent).toEqual([source])
    expect(mappings.some((mapping) => mapping.source === filename && mapping.originalLine === 4))
      .toBe(true)
  })

  test('maps multiline module, setup, and style bodies to their authored lines', () => {
    const filename = '/project/src/Embedded.btsx'
    const source = [
      'module',
      '  const answer = 42;',
      'setup',
      '  const value = answer;',
      '  if (value) {',
      '    console.log(value);',
      '  }',
      'fragment',
      '  style',
      '    .card {',
      '      color: red;',
      '    }',
      '  div.card'
    ].join('\n') + '\n'
    const result = compileBeastResult(source, { filename })
    const generatedLines = result.code.split('\n')
    const map = new TraceMap(result.map)
    const originalFor = (text: string) => {
      const lineIndex = generatedLines.findIndex((line) => line.includes(text))
      if (lineIndex === -1) throw new Error(`Missing generated line containing ${text}.`)
      const line = generatedLines[lineIndex] ?? ''
      return originalPositionFor(map, {
        line: lineIndex + 1,
        column: line.search(/\S/u)
      })
    }

    expect(originalFor('const answer')).toMatchObject({ line: 2, column: 2 })
    expect(originalFor('const value')).toMatchObject({ line: 4, column: 2 })
    expect(originalFor('console.log')).toMatchObject({ line: 6, column: 4 })
    expect(originalFor('.card {')).toMatchObject({ line: 10, column: 4 })
    expect(originalFor('color: red')).toMatchObject({ line: 11, column: 6 })
  })

  test('emits explicit fragments and verbatim scoped style blocks', async () => {
    const filename = resolve('examples/styling/styling.btsx')
    const source = await readFile(filename, 'utf8')
    const result = compileBeastResult(source, { filename })

    expect(result.ast.children[0]).toMatchObject({
      kind: 'fragment',
      children: [
        { kind: 'element' },
        {
          kind: 'style',
          css: [
            '.card {',
            '  padding: 1rem;',
            '}',
            '',
            '.card h2 {',
            '  color: rebeccapurple;',
            '}',
            '',
            ':global(body) {',
            '  margin: 0;',
            '}'
          ].join('\n')
        }
      ]
    })
    expect(result.code).toContain('\t<>\n\t\t<article className="card" {...cardProps}>')
    expect(result.code).toContain('\t\t<style>\n\t\t\t.card {\n\t\t\t  padding: 1rem;\n\t\t\t}')

    const tsrxFilename = filename.replace(/\.btsx$/u, '.tsrx')
    const client = compile(result.code, tsrxFilename, {
      mode: 'client',
      hmr: false,
      dev: true
    })
    expect(client.diagnostics).toHaveLength(0)
    expect(client.code).toContain('injectStyle')
    expect(client.code).toContain('snapshotSpread')

    const server = compile(result.code, tsrxFilename, {
      mode: 'server',
      hmr: false,
      dev: true
    })
    expect(server.diagnostics).toHaveLength(0)
    const rendered = await renderCompiledServerResult(server.code, {
      title: 'Scoped card',
      cardProps: { 'data-tone': 'bright' }
    })

    expect(rendered.html).toMatch(/<article class="card tsrx-[a-z0-9]+" data-tone="bright">/u)
    expect(rendered.css).toContain('padding: 1rem;')
    expect(rendered.css).toContain('color: rebeccapurple;')
    expect(rendered.css).toContain('body {')
    expect(rendered.css).toContain('margin: 0;')
  })

  test.each([
    ['empty fragment', 'fragment\n', 'BEAST1901_EMPTY_FRAGMENT'],
    ['empty style', 'style\n', 'BEAST1902_EMPTY_STYLE'],
    ['empty spread', 'button({...})\n', 'BEAST1202_INVALID_ATTRIBUTE'],
    ['non-spread braces', 'button({props})\n', 'BEAST1202_INVALID_ATTRIBUTE']
  ])('reports invalid element syntax for %s', (_label, source, code) => {
    expect(getCompileError(source, 'InvalidElement.btsx').diagnostic.code).toBe(code)
  })

  test('compiles advanced hook APIs and preserves their server semantics', async () => {
    const filename = resolve('examples/hooks/hooks.btsx')
    const source = await readFile(filename, 'utf8')
    const result = compileBeastResult(source, { filename })

    for (const api of [
      'memo(',
      'useCallback(',
      'useDebugValue(',
      'useEffectEvent(',
      'useId(',
      'useImperativeHandle(',
      'useInsertionEffect(',
      'useLayoutEffect(',
      'useReducer('
    ]) {
      expect(result.code).toContain(api)
    }

    const tsrxFilename = filename.replace(/\.btsx$/u, '.tsrx')
    const client = compile(result.code, tsrxFilename, {
      mode: 'client',
      hmr: false,
      dev: true
    })
    expect(client.diagnostics).toHaveLength(0)
    expect(client.code).toContain('__useReducerWithGetter')
    expect(client.code).toContain('useMemo(() => memo(CountSummary, sameSummary), [], 2)')
    expect(client.code).toContain('useCallback(() => dispatch({ type: "increment" }), [], 3)')
    expect(client.code).toContain('useEffectEvent(() => onReport(getCount()), 4)')
    expect(client.code).toContain('useImperativeHandle(handleRef')
    expect(client.code).toContain('useInsertionEffect(')
    expect(client.code).toContain('useLayoutEffect(')

    const server = compile(result.code, tsrxFilename, {
      mode: 'server',
      hmr: false,
      dev: true
    })
    expect(server.diagnostics).toHaveLength(0)
    const phases: string[] = []
    const reports: number[] = []
    const handleRef: { current: { reset(): void; read(): number } | null } = {
      current: null
    }
    const rendered = await renderCompiledServerResult(server.code, {
      initialCount: 3,
      handleRef,
      onPhase: (phase: string) => phases.push(phase),
      onReport: (count: number) => reports.push(count)
    })

    const id = rendered.html.match(/aria-labelledby="([^"]+)"/u)?.[1]
    expect(id).toBeDefined()
    expect(rendered.html).toContain(`<h2 id="${id}">Advanced hooks</h2>`)
    expect(rendered.html).toContain('<p>Reducer count: <!--[-->6<!--]--></p>')
    expect(phases).toEqual([])
    expect(reports).toEqual([])
    expect(handleRef.current).toBeNull()
  })

  test('renders Promise use outcomes and every Activity mode', async () => {
    const filename = resolve('examples/async/async.btsx')
    const source = await readFile(filename, 'utf8')
    const result = compileBeastResult(source, { filename })
    const tsrxFilename = filename.replace(/\.btsx$/u, '.tsrx')

    const client = compile(result.code, tsrxFilename, {
      mode: 'client',
      hmr: false,
      dev: true
    })
    expect(client.diagnostics).toHaveLength(0)
    expect(client.code).toContain('activityBlock')
    expect(client.code).toContain('"visible", __activity')
    expect(client.code).toContain('"hidden", __activity')
    expect(client.code).toContain('"prerender", __activity')
    expect(client.code).toContain('const resolved = use(')

    const server = compile(result.code, tsrxFilename, {
      mode: 'server',
      hmr: false,
      dev: true
    })
    expect(server.diagnostics).toHaveLength(0)

    const fulfilled = await renderCompiledServerResult(server.code, {
      profile: {
        status: 'fulfilled',
        value: { name: 'Ada', role: 'Engineer' },
        then() {}
      }
    })
    expect(fulfilled.html).toContain('<article class="profile"><h2>Ada</h2>')
    expect(fulfilled.html).toContain('<p>Engineer</p>')
    expect(fulfilled.html).toContain('<p>Visible activity</p>')
    expect(fulfilled.html).not.toContain('Hidden activity')
    expect(fulfilled.html).toContain('<p>Prerendered activity</p>')

    const pending = await renderCompiledServerResult(server.code, {
      profile: { status: 'pending', then() {} }
    })
    expect(pending.html).toContain('Loading profile…')
    expect(pending.html).not.toContain('<article class="profile">')

    const rejected = await renderCompiledServerResult(server.code, {
      profile: { status: 'rejected', reason: new Error('Unavailable'), then() {} }
    })
    expect(rejected.html).toContain('Profile failed.')
    expect(rejected.html).toContain('"message":"Unavailable"')
  })

  test('covers every hydration strategy and the complete Hydrate prop surface', async () => {
    const filename = resolve('examples/hydration/hydration.btsx')
    const source = await readFile(filename, 'utf8')
    const result = compileBeastResult(source, { filename })

    for (const call of [
      'load()',
      'idle({ timeout: 1000 })',
      'visible({ rootMargin: "300px", threshold: [0, 0.5] })',
      'media("(min-width: 64rem)")',
      'interaction({ events: ["focusin", "click"] })',
      'condition(enabled)',
      'never()'
    ]) {
      expect(result.code).toContain(call)
    }
    expect(result.code).toContain('prefetch={prefetchPanel}')
    expect(result.code).toContain('fallback="Preparing editor…"')
    expect(result.code).toContain('onHydrated={onHydrated}')

    const tsrxFilename = filename.replace(/\.btsx$/u, '.tsrx')
    const client = compile(result.code, tsrxFilename, {
      mode: 'client',
      hmr: false,
      dev: true
    })
    expect(client.diagnostics).toHaveLength(0)
    expect(client.code).toContain('Hydrate.__octanePermanentStatic')
    expect(client.code).toContain('?octane-hydrate=8"')
    expect(client.code).toContain("'prefetch': prefetchPanel")

    const splitChild = compile(result.code, `${tsrxFilename}?octane-hydrate=8`, {
      mode: 'client',
      hmr: false,
      dev: true
    })
    expect(splitChild.diagnostics).toHaveLength(0)
    expect(splitChild.code).toContain('__OctaneHydrateBoundary_8')
    expect(splitChild.code).toContain('Split and prefetched')

    const server = compile(result.code, tsrxFilename, {
      mode: 'server',
      hmr: false,
      dev: true
    })
    expect(server.diagnostics).toHaveLength(0)
    const hydrated: string[] = []
    const warmed: AbortSignal[] = []
    const rendered = await renderCompiledServerResult(server.code, {
      enabled: true,
      onHydrated: () => hydrated.push('done'),
      warm: async (signal: AbortSignal) => {
        warmed.push(signal)
      }
    })

    for (const strategy of ['load', 'idle', 'visible', 'media', 'interaction', 'condition', 'dynamic']) {
      expect(rendered.html).toContain(`data-octane-hydrate-when="${strategy}"`)
    }
    expect(rendered.html).toContain('data-octane-hydrate-interaction-events="focusin click"')
    expect(rendered.html).toContain('<!--octane-static-hydrate:0-->')
    expect(rendered.html).toContain('<h2>Never</h2>')
    expect(rendered.html).toContain('<h2>Procedural prefetch</h2>')
    expect(hydrated).toEqual([])
    expect(warmed).toEqual([])
  })

  test('installs early hydration event capture once per document', () => {
    const registrations: Array<{ type: string; capture: boolean }> = []
    const ownerDocument = {
      addEventListener(type: string, _listener: EventListener, capture: boolean) {
        registrations.push({ type, capture })
      }
    } as unknown as Document

    initializeHydrationEventCapture(ownerDocument)
    const firstCount = registrations.length
    initializeHydrationEventCapture(ownerDocument)

    expect(firstCount).toBeGreaterThan(0)
    expect(registrations).toHaveLength(firstCount)
    expect(new Set(registrations.map(({ type }) => type)).size).toBe(firstCount)
    expect(registrations.every(({ capture }) => capture)).toBe(true)
  })

  test('renders resource hints and executes descriptor and Children helpers', async () => {
    const filename = resolve('examples/library/library.btsx')
    const source = await readFile(filename, 'utf8')
    const result = compileBeastResult(source, { filename })
    const tsrxFilename = filename.replace(/\.btsx$/u, '.tsrx')

    const client = compile(result.code, tsrxFilename, {
      mode: 'client',
      hmr: false,
      dev: true
    })
    expect(client.diagnostics).toHaveLength(0)
    for (const api of [
      'Children.forEach',
      'Children.map',
      'Children.count',
      'Children.toArray',
      'Children.only',
      'cloneElement',
      'createElement',
      'isChildrenBlock',
      'isValidElement',
      'preconnect',
      'prefetchDNS',
      'preinit',
      'preinitModule',
      'preload',
      'preloadModule'
    ]) {
      expect(client.code).toContain(api)
    }
    expect(client.code).toContain('markChildrenBlock')

    const server = compile(result.code, tsrxFilename, {
      mode: 'server',
      hmr: false,
      dev: true
    })
    expect(server.diagnostics).toHaveLength(0)
    const rendered = await renderCompiledServerResult(server.code)

    expect(rendered.html.match(/<link rel="preload"[^>]*beast\.woff2[^>]*>/gu)).toHaveLength(1)
    expect(rendered.html).toContain('<link rel="stylesheet" href="/assets/app.css" data-precedence="critical">')
    expect(rendered.html).toContain('<script src="/assets/runtime.js" async data-oct-res=""></script>')
    expect(rendered.html).toContain('<link rel="modulepreload" href="/assets/chart.js" crossorigin="anonymous"')
    expect(rendered.html).toContain('<script type="module" src="/assets/editor.js" async')
    expect(rendered.html).toContain('<link rel="preconnect" href="https://api.example.com" crossorigin="anonymous"')
    expect(rendered.html).toContain('<link rel="dns-prefetch" href="https://cdn.example.com"')
    expect(rendered.html.indexOf('/assets/app.css')).toBeLessThan(
      rendered.html.indexOf('<section class="library-apis">')
    )
    expect(rendered.html).toContain('<p data-count="4" data-flattened="2" data-visited="4" data-valid="true">')
    expect(rendered.html).toContain('<li class="base" data-kind="base" data-index="0">Base</li>')
    expect(rendered.html).toContain('<li class="cloned" data-kind="clone" data-index="3">Cloned</li>')
    expect(rendered.html).toContain('<section class="children-probe" data-children-block="true">')
  })

  test('passes through version and ViewTransitionPseudoElement integrations', async () => {
    const source = [
      'import { ViewTransitionPseudoElement, version } from "octane";',
      'module',
      '  export function animateHero() {',
      '    const pseudo = new ViewTransitionPseudoElement("new", "hero");',
      '    return pseudo.animate([{ opacity: 0 }, { opacity: 1 }], 180);',
      '  }',
      'p Octane #{version}'
    ].join('\n')
    const result = compileBeastResult(source, { filename: 'RuntimeInfo.btsx' })
    const client = compile(result.code, 'RuntimeInfo.tsrx', {
      mode: 'client',
      hmr: false,
      dev: true
    })

    expect(client.diagnostics).toHaveLength(0)
    expect(client.code).toContain('ViewTransitionPseudoElement')
    expect(client.code).toContain('version')
    const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
      devDependencies: { octane: string }
    }
    expect(version).toBe(manifest.devDependencies.octane.replace(/^\^/, ''))

    const selector = '::view-transition-new(hero)'
    const matching = { effect: { pseudoElement: selector } } as unknown as Animation
    const other = {
      effect: { pseudoElement: '::view-transition-old(hero)' }
    } as unknown as Animation
    const calls: Array<{ keyframes: unknown; options: unknown }> = []
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        documentElement: {
          animate(keyframes: unknown, options: unknown) {
            calls.push({ keyframes, options })
            return matching
          },
          getAnimations() {
            return [matching, other]
          }
        }
      }
    })

    try {
      const pseudo = new ViewTransitionPseudoElement('new', 'hero')
      const keyframes = [{ opacity: 0 }, { opacity: 1 }]
      expect(pseudo.selector).toBe(selector)
      expect(pseudo.animate(keyframes, 180)).toBe(matching)
      expect(calls).toEqual([{ keyframes, options: { duration: 180, pseudoElement: selector } }])
      expect(pseudo.getAnimations()).toEqual([matching])
    } finally {
      if (previousDocument === undefined) {
        delete (globalThis as { document?: Document }).document
      } else {
        Object.defineProperty(globalThis, 'document', previousDocument)
      }
    }
  })

  test('emits Octane empty branches for loops', () => {
    const result = compileBeastResult('each item in items key item.id\n  Row(item={item})\nempty\n  p No items.\n', {
      filename: 'List.btsx'
    })

    expect(result.code).toContain(
      '\t@for (const item of items; key item.id) {\n\t\t<Row item={item} />\n\t} @empty {\n\t\t<p>No items.</p>\n\t}'
    )
    const loop = result.ast.children[0]
    expect(loop?.kind).toBe('each')
    if (loop?.kind === 'each') expect(loop.emptyChildren).toHaveLength(1)
  })

  test('preserves dotted component APIs without changing class shorthand', () => {
    const output = compileBeast('Theme.Provider(value={theme})\n  Card.featured Featured\n', {
      filename: 'ThemeShell.btsx'
    })

    expect(output).toContain('<Theme.Provider value={theme}>')
    expect(output).toContain('<Card className="featured">Featured</Card>')
    expect(output).toContain('</Theme.Provider>')
  })

  test.each([
    ['orphan empty', 'empty\n  p Nothing\n', 'BEAST1407_ORPHAN_EMPTY'],
    ['empty empty branch', 'each item in items\n  p #{item}\nempty\np After\n', 'BEAST1408_EMPTY_EMPTY_BRANCH']
  ])('reports invalid loop syntax for %s', (_label, source, code) => {
    const error = getCompileError(source, 'InvalidLoop.btsx')
    expect(error.diagnostic.code).toBe(code)
  })

  test('emits isolated Octane switch arms', () => {
    const result = compileBeastResult(
      [
        'switch status',
        '  case "ready"',
        '    ReadyView',
        '  case "loading"',
        '    LoadingView',
        '  default',
        '    UnknownView'
      ].join('\n'),
      { filename: 'StatusView.btsx' }
    )

    expect(result.code).toContain('\t@switch (status) {\n\t\t@case "ready": {\n\t\t\t<ReadyView />\n\t\t}')
    expect(result.code).toContain('\t\t@default: {\n\t\t\t<UnknownView />\n\t\t}')
    const node = result.ast.children[0]
    expect(node?.kind).toBe('switch')
    if (node?.kind === 'switch') {
      expect(node.discriminant).toBe('status')
      expect(node.branches.map((branch) => branch.test)).toEqual(['"ready"', '"loading"', null])
    }
  })

  test.each([
    ['empty switch', 'switch\n', 'BEAST1601_EMPTY_SWITCH'],
    ['empty switch body', 'switch status\n', 'BEAST1602_EMPTY_SWITCH_BODY'],
    ['invalid direct child', 'switch status\n  p Not an arm\n', 'BEAST1603_INVALID_SWITCH_ARM'],
    ['empty case expression', 'switch status\n  case\n    p Missing expression\n', 'BEAST1604_EMPTY_CASE'],
    [
      'duplicate default',
      'switch status\n  default\n    p First\n  default\n    p Second\n',
      'BEAST1605_DUPLICATE_DEFAULT'
    ],
    ['empty switch arm', 'switch status\n  case "ready"\n  default\n    p Other\n', 'BEAST1606_EMPTY_SWITCH_ARM'],
    ['orphan case', 'case "ready"\n  p Ready\n', 'BEAST1607_ORPHAN_SWITCH_ARM'],
    ['orphan default', 'default\n  p Other\n', 'BEAST1607_ORPHAN_SWITCH_ARM']
  ])('reports invalid switch syntax for %s', (_label, source, code) => {
    const error = getCompileError(source, 'InvalidSwitch.btsx')
    expect(error.diagnostic.code).toBe(code)
  })

  test('emits pending and catch boundaries with optional bindings', () => {
    const result = compileBeastResult(
      [
        'try',
        '  Profile(data={data})',
        'pending',
        '  p Loading profile…',
        'catch (error, reset)',
        '  button(type="button" onClick={reset}) #{String(error)}'
      ].join('\n'),
      { filename: 'ProfileBoundary.btsx' }
    )

    expect(result.code).toContain(
      '\t@try {\n\t\t<Profile data={data} />\n\t} @pending {\n\t\t<p>Loading profile…</p>\n\t} @catch (error, reset) {'
    )
    const node = result.ast.children[0]
    expect(node?.kind).toBe('try')
    if (node?.kind === 'try') {
      expect(node.pendingBranch?.children).toHaveLength(1)
      expect(node.catchBranch?.bindings).toBe('error, reset')
    }
  })

  test.each([
    ['pending only', 'try\n  Profile\npending\n  p Loading\n', '@pending {'],
    ['catch only', 'try\n  Profile\ncatch\n  p Failed\n', '@catch {'],
    [
      'unwrapped catch bindings',
      'try\n  Profile\ncatch error, reset\n  button(onClick={reset}) #{String(error)}\n',
      '@catch (error, reset) {'
    ]
  ])('supports %s try boundaries', (_label, source, expected) => {
    expect(compileBeast(source, { filename: 'Boundary.btsx' })).toContain(expected)
  })

  test.each([
    ['invalid try header', 'try value\n  p Value\n', 'BEAST1701_INVALID_TRY_HEADER'],
    ['empty try body', 'try\npending\n  p Loading\n', 'BEAST1702_EMPTY_TRY_BODY'],
    ['missing continuation', 'try\n  p Content\np After\n', 'BEAST1703_MISSING_TRY_BRANCH'],
    ['invalid pending header', 'try\n  p Content\npending value\n  p Loading\n', 'BEAST1704_INVALID_PENDING_HEADER'],
    ['empty pending branch', 'try\n  p Content\npending\n', 'BEAST1705_EMPTY_PENDING_BRANCH'],
    ['empty catch bindings', 'try\n  p Content\ncatch ()\n  p Failed\n', 'BEAST1706_INVALID_CATCH_BINDINGS'],
    ['empty catch branch', 'try\n  p Content\ncatch error\n', 'BEAST1707_EMPTY_CATCH_BRANCH'],
    [
      'pending after catch',
      'try\n  p Content\ncatch\n  p Failed\npending\n  p Loading\n',
      'BEAST1708_PENDING_AFTER_CATCH'
    ],
    ['duplicate pending', 'try\n  p Content\npending\n  p One\npending\n  p Two\n', 'BEAST1709_DUPLICATE_PENDING'],
    ['duplicate catch', 'try\n  p Content\ncatch\n  p One\ncatch error\n  p Two\n', 'BEAST1710_DUPLICATE_CATCH'],
    ['orphan pending', 'pending\n  p Loading\n', 'BEAST1711_ORPHAN_TRY_BRANCH'],
    ['orphan catch', 'catch error\n  p Failed\n', 'BEAST1711_ORPHAN_TRY_BRANCH']
  ])('reports invalid try syntax for %s', (_label, source, code) => {
    const error = getCompileError(source, 'InvalidBoundary.btsx')
    expect(error.diagnostic.code).toBe(code)
  })

  test('emits source-level imports, props, and setup declarations', () => {
    const result = compileBeastResult(
      [
        'import type { User } from "./types.ts";',
        'import Avatar from "./Avatar.btsx";',
        'props { user }: { user: User };',
        'setup const label = user.name;',
        'Avatar(user={user} label={label})'
      ].join('\n'),
      { filename: 'Profile.btsx' }
    )

    expect(result.code).toStartWith(
      [
        'import type { User } from "./types.ts";',
        'import Avatar from "./Avatar.btsx";',
        '',
        'export default function Profile({ user }: { user: User }) @{'
      ].join('\n')
    )
    expect(result.code).toContain('\n\tconst label = user.name;\n\n\t<Avatar')
    expect(result.ast.declarations.map((declaration) => declaration.kind)).toEqual([
      'import',
      'import',
      'props',
      'setup'
    ])
  })

  test('emits tagless local component declarations', () => {
    const source = [
      'module interface GreetingProps { name: string }',
      'component Greeting',
      '  props { name }: GreetingProps',
      '  setup const label = "Hello, " + name;',
      '  strong #{label}',
      'props { name }: GreetingProps',
      'Greeting(name={name})'
    ].join('\n')
    const result = compileBeastResult(source, { filename: 'Welcome.btsx' })

    expect(source).not.toMatch(/<\/?[A-Za-z]/u)
    expect(result.code).toContain(
      'function Greeting({ name }: GreetingProps) @{\n\tconst label = "Hello, " + name;\n\n\t<strong>{label}</strong>\n}'
    )
    expect(result.code).toContain('export default function Welcome({ name }: GreetingProps) @{')
    const component = result.ast.declarations.find((declaration) => declaration.kind === 'component')
    expect(component).toMatchObject({
      kind: 'component',
      name: 'Greeting',
      props: { kind: 'props', parameter: '{ name }: GreetingProps' }
    })
    if (component?.kind === 'component') {
      expect(component.setup).toHaveLength(1)
      expect(component.children).toHaveLength(1)
    }
  })

  test('preserves multiline module and setup source blocks', () => {
    const result = compileBeastResult(
      [
        'module',
        '  "use strong";',
        '  const shortcutKey = "/";',
        '',
        'import { useEffect, useRef } from "octane";',
        'setup',
        '  const inputRef = useRef<HTMLInputElement | null>(null);',
        '',
        '  // Preserve source comments and relative indentation.',
        '  useEffect(() => {',
        '    window.addEventListener("keydown", focusInput);',
        '    return () => window.removeEventListener("keydown", focusInput);',
        '  });',
        '',
        'input(ref={inputRef} aria-keyshortcuts={shortcutKey})'
      ].join('\n'),
      { filename: 'Shortcut.btsx' }
    )

    expect(result.ast.declarations.map((declaration) => declaration.kind)).toEqual(['module', 'import', 'setup'])
    expect(result.ast.declarations[0]).toMatchObject({
      kind: 'module',
      code: '"use strong";\nconst shortcutKey = "/";'
    })
    expect(result.ast.declarations[2]).toMatchObject({
      kind: 'setup',
      code: [
        'const inputRef = useRef<HTMLInputElement | null>(null);',
        '',
        '// Preserve source comments and relative indentation.',
        'useEffect(() => {',
        '  window.addEventListener("keydown", focusInput);',
        '  return () => window.removeEventListener("keydown", focusInput);',
        '});'
      ].join('\n')
    })
    expect(result.code).toStartWith(
      '"use strong";\nconst shortcutKey = "/";\nimport { useEffect, useRef } from "octane";\n'
    )
    expect(result.code).toContain(
      '\tconst inputRef = useRef<HTMLInputElement | null>(null);\n\n\t// Preserve source comments'
    )
  })

  test('passes controlled linked-state input through Octane without native-event warnings', () => {
    const source = [
      'module "use strong";',
      'import { useLinkedState } from "octane";',
      'props { user }: { user: { id: string; name: string } }',
      'setup const [name, setName] = useLinkedState(user.id, () => user.name);',
      'input(value={name} onInput={(event) => setName(event.currentTarget.value)})'
    ].join('\n')
    const code = compileBeast(source, { filename: 'LinkedInput.btsx' })

    expect(code).toContain('const [name, setName] = useLinkedState(user.id, () => user.name);')
    expect(code).toContain('<input value={name} onInput={(event) => setName(event.currentTarget.value)} />')
    const octane = compile(code, 'LinkedInput.tsrx', {
      mode: 'client',
      hmr: false,
      dev: true
    })
    expect(octane.diagnostics).toHaveLength(0)
  })

  test('preserves callback and object ref arrays for Octane', () => {
    const result = compileBeastResult(
      [
        'import { useRef } from "octane";',
        'setup const inputRef = useRef<HTMLInputElement | null>(null);',
        'setup const reportInput = (element: HTMLInputElement | null) => { report(element); return () => report(null); };',
        'input(ref={[inputRef, reportInput]})'
      ].join('\n'),
      { filename: 'MultiRef.btsx' }
    )

    expect(result.code).toContain('<input ref={[inputRef, reportInput]} />')
    const input = result.ast.children[0]
    expect(input?.kind).toBe('element')
    if (input?.kind === 'element') {
      expect(input.attrs[0]).toMatchObject({
        name: 'ref',
        value: { type: 'expr', code: '[inputRef, reportInput]' }
      })
    }
    const octane = compile(result.code, 'MultiRef.tsrx', {
      mode: 'client',
      hmr: false,
      dev: true
    })
    expect(octane.diagnostics).toHaveLength(0)
  })

  test('compiles tagless local context consumers and a dotted provider', () => {
    const result = compileBeastResult(
      [
        'import { createContext, use, useContext } from "octane";',
        'module const Theme = createContext("light");',
        'component ThemeReader',
        '  setup const direct = use(Theme);',
        '  setup const explicit = useContext(Theme);',
        '  p #{direct + ":" + explicit}',
        'props { theme }: { theme: string }',
        'Theme.Provider(value={theme})',
        '  ThemeReader'
      ].join('\n'),
      { filename: 'ContextReader.btsx' }
    )

    expect(result.code).toContain('const Theme = createContext("light");')
    expect(result.code).toContain('const direct = use(Theme);')
    expect(result.code).toContain('const explicit = useContext(Theme);')
    expect(result.code).toContain('<Theme.Provider value={theme}>')
    const octane = compile(result.code, 'ContextReader.tsrx', {
      mode: 'client',
      hmr: false,
      dev: true
    })
    expect(octane.diagnostics).toHaveLength(0)
  })

  test('composes lazy loading, runtime boundaries, and deferred hydration', () => {
    const result = compileBeastResult(
      [
        'import { ErrorBoundary, Hydrate, Suspense, lazy } from "octane";',
        'import { visible } from "octane/hydration";',
        'module const LazyPanel = lazy(() => import("./Panel.tsrx"));',
        'props { reportId }: { reportId: string }',
        'ErrorBoundary(fallback="Dashboard failed.")',
        '  Suspense(fallback="Loading dashboard…")',
        '    LazyPanel(reportId={reportId})',
        '  Hydrate(when={visible()} split={false})',
        '    button(type="button") Open reviews'
      ].join('\n'),
      { filename: 'DeferredDashboard.btsx' }
    )

    expect(result.code).toContain('const LazyPanel = lazy(() => import("./Panel.tsrx"));')
    expect(result.code).toContain('<ErrorBoundary fallback="Dashboard failed.">')
    expect(result.code).toContain('<Suspense fallback="Loading dashboard…">')
    expect(result.code).toContain('<Hydrate when={visible()} split={false}>')

    const octane = compile(result.code, 'DeferredDashboard.tsrx', {
      mode: 'client',
      hmr: false,
      dev: true
    })
    expect(octane.diagnostics).toHaveLength(0)
    expect(octane.code).toContain('lazy(() => import("./Panel.tsrx"))')
    expect(octane.code).toContain('Hydrate')
    expect(octane.code).toContain('Suspense')
    expect(octane.code).not.toContain('octane-hydrate=')

    const server = compile(result.code, 'DeferredDashboard.tsrx', {
      mode: 'server',
      hmr: false,
      dev: true
    })
    expect(server.diagnostics).toHaveLength(0)
    expect(server.code).toContain('octane/server')
  })

  test("compiles the deferred fixture's lazy TSRX module", async () => {
    const filename = resolve('examples/deferred/analytics.tsrx')
    const source = await readFile(filename, 'utf8')
    const octane = compile(source, filename, {
      mode: 'client',
      hmr: false,
      dev: true
    })

    expect(octane.diagnostics).toHaveLength(0)
    expect(octane.code.length).toBeGreaterThan(0)
  })

  test("renders an external store's deterministic server snapshot", async () => {
    const filename = resolve('examples/network/network.btsx')
    const source = await readFile(filename, 'utf8')
    const result = compileBeastResult(source, { filename })

    expect(result.code).toContain('useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)')
    const client = compile(result.code, filename.replace(/\.btsx$/u, '.tsrx'), {
      mode: 'client',
      hmr: false,
      dev: true
    })
    expect(client.diagnostics).toHaveLength(0)
    expect(client.code).toContain('useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot, 0)')

    const server = compile(result.code, filename.replace(/\.btsx$/u, '.tsrx'), {
      mode: 'server',
      hmr: false,
      dev: true
    })
    expect(server.diagnostics).toHaveLength(0)
    expect(server.code).toContain('useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot, 0)')

    expect(await renderCompiledServer(server.code)).toContain(
      '<p class="network-status" role="status" aria-live="polite">Online</p>'
    )
  })

  test('compiles and server-renders transition and deferred-value hooks', async () => {
    const filename = resolve('examples/responsive/responsive.btsx')
    const source = await readFile(filename, 'utf8')
    const result = compileBeastResult(source, { filename })

    expect(result.code).toContain('const [tab, setTab] = useState<Tab>("overview");')
    expect(result.code).toContain('const [isPending, startTransition] = useTransition();')
    expect(result.code).toContain('const deferredQuery = useDeferredValue(query);')

    const tsrxFilename = filename.replace(/\.btsx$/u, '.tsrx')
    const client = compile(result.code, tsrxFilename, {
      mode: 'client',
      hmr: false,
      dev: true
    })
    expect(client.diagnostics).toHaveLength(0)
    expect(client.code).toContain('useState("overview", 0)')
    expect(client.code).toContain('useTransition(1)')
    expect(client.code).toContain('useState("", 2)')
    expect(client.code).toContain('useDeferredValue(query, 3)')

    const server = compile(result.code, tsrxFilename, {
      mode: 'server',
      hmr: false,
      dev: true
    })
    expect(server.diagnostics).toHaveLength(0)
    const rendered = await renderCompiledServer(server.code)

    expect(rendered).toContain('>Activity</button>')
    expect(rendered).toContain('<p>Overview is ready.</p>')
    expect(rendered).toContain('<p>Showing results for all products</p>')
  })

  test('compiles and server-renders view-transition boundaries', async () => {
    const filename = resolve('examples/transitions/transitions.btsx')
    const source = await readFile(filename, 'utf8')
    const result = compileBeastResult(source, { filename })

    expect(result.code).toContain('addTransitionType(next === "activity" ? "forward" : "backward")')
    expect(result.code).toContain('<ViewTransition name="project-panel" enter="panel-enter" exit="panel-exit"')
    expect(result.code).toContain(
      'update={{ default: "panel-update", forward: "slide-left", backward: "slide-right" }}'
    )

    const tsrxFilename = filename.replace(/\.btsx$/u, '.tsrx')
    const client = compile(result.code, tsrxFilename, {
      mode: 'client',
      hmr: false,
      dev: true
    })
    expect(client.diagnostics).toHaveLength(0)
    expect(client.code).toContain('_$__vtSeen();')
    expect(client.code).toContain('addTransitionType(next === "activity"')
    expect(client.code).toContain('ViewTransition,')

    const server = compile(result.code, tsrxFilename, {
      mode: 'server',
      hmr: false,
      dev: true
    })
    expect(server.diagnostics).toHaveLength(0)
    const rendered = await renderCompiledServer(server.code)

    expect(rendered).toContain(
      '<article class="project-panel" vt-name="project-panel" vt-update="panel-update" vt-share="auto">'
    )
    expect(rendered).toContain('<h3>Overview</h3>')
    expect(rendered).toContain('<p>Overview is ready.</p>')
  })

  test('compiles portal descriptors and preserves their server placeholder', async () => {
    const filename = resolve('examples/portal/portal.btsx')
    const source = await readFile(filename, 'utf8')
    const result = compileBeastResult(source, { filename })

    expect(result.code).toContain('return createPortal(ToastBody, target, { onDismiss });')
    expect(result.code).toContain('<section className="editor" onClick={onBubble}>')
    expect(result.code).toContain('<SavedToast target={target} onDismiss={onDismiss} />')

    const tsrxFilename = filename.replace(/\.btsx$/u, '.tsrx')
    const client = compile(result.code, tsrxFilename, {
      mode: 'client',
      hmr: false,
      dev: true
    })
    expect(client.diagnostics).toHaveLength(0)
    expect(client.code).toContain('return createPortal(ToastBody, target, { onDismiss });')
    expect(client.code).toContain("SavedToast, { 'target': target")

    const server = compile(result.code, tsrxFilename, {
      mode: 'server',
      hmr: false,
      dev: true
    })
    expect(server.diagnostics).toHaveLength(0)
    const rendered = await renderCompiledServer(server.code, {
      target: {},
      onDismiss: () => {},
      onBubble: () => {}
    })

    expect(rendered).toContain('<section class="editor">')
    expect(rendered).toContain('Portal clicks still follow their logical Beast parent.')
    expect(rendered).toContain('<!---->')
    expect(rendered).not.toContain('Draft saved.')
  })

  test('compiles and server-renders action and form hooks', async () => {
    const filename = resolve('examples/actions/actions.btsx')
    const source = await readFile(filename, 'utf8')
    const result = compileBeastResult(source, { filename })

    expect(result.code).toContain('const { pending, data, method } = useFormStatus();')
    expect(result.code).toContain('const [optimisticNames, addOptimisticName]')
    expect(result.code).toContain('const [message, submit, isPending] = useActionState(')
    expect(result.code).toContain('requestFormReset(formRef.current)')
    expect(result.code).toContain('<form ref={formRef} action={submit}>')

    const tsrxFilename = filename.replace(/\.btsx$/u, '.tsrx')
    const client = compile(result.code, tsrxFilename, {
      mode: 'client',
      hmr: false,
      dev: true
    })
    expect(client.diagnostics).toHaveLength(0)
    expect(client.code).toContain('useFormStatus(0)')
    expect(client.code).toContain('useRef(null, 1)')
    expect(client.code).toContain('useOptimistic(names, (current, name) => [...current, name], 2)')
    expect(client.code).toMatch(/useActionState\([\s\S]*?"Save a name\.",\s*undefined,\s*3\s*\)/u)
    expect(client.code).toContain('requestFormReset(formRef.current)')
    expect(client.code).toContain('_$setFormAction')

    const server = compile(result.code, tsrxFilename, {
      mode: 'server',
      hmr: false,
      dev: true
    })
    expect(server.diagnostics).toHaveLength(0)
    const rendered = await renderCompiledServer(server.code, {
      names: ['Ada', 'Grace'],
      saveName: async () => {}
    })

    expect(rendered).toContain('<li>Ada</li>')
    expect(rendered).toContain('<li>Grace</li>')
    expect(rendered).toContain('>Save name</button>')
    expect(rendered).toContain('Save a name.</p>')
  })

  test('lets explicit compile options override source-level props', () => {
    const output = compileBeast('props { value }: { value: string }\np #{value}\n', {
      filename: 'Value.btsx',
      propsParam: '{ value }: { value: number }'
    })
    expect(output).toStartWith('export default function Value({ value }: { value: number }) @{\n')
  })

  test('rejects duplicate and misplaced declarations', () => {
    const duplicate = getCompileError(
      'props { one }: { one: string }\nprops { two }: { two: string }\np Hi\n',
      'Duplicate.btsx'
    )
    expect(duplicate.diagnostic.code).toBe('BEAST1501_DUPLICATE_PROPS')

    const misplaced = getCompileError('p Hi\nimport Thing from "./Thing.btsx";\n', 'Misplaced.btsx')
    expect(misplaced.diagnostic.code).toBe('BEAST1503_MISPLACED_DECLARATION')

    const misplacedSetup = getCompileError('p Hi\nsetup const value = 1;\n', 'Setup.btsx')
    expect(misplacedSetup.diagnostic.code).toBe('BEAST1503_MISPLACED_DECLARATION')

    const misplacedModule = getCompileError('p Hi\nmodule const value = 1;\n', 'Module.btsx')
    expect(misplacedModule.diagnostic.code).toBe('BEAST1503_MISPLACED_DECLARATION')

    const misplacedComponent = getCompileError('p Hi\ncomponent Helper\n  p Nested\n', 'Component.btsx')
    expect(misplacedComponent.diagnostic.code).toBe('BEAST1503_MISPLACED_DECLARATION')
  })

  test.each([
    ['empty props', 'props\n', 'BEAST1502_EMPTY_PROPS'],
    ['empty import', 'import\n', 'BEAST1504_EMPTY_IMPORT'],
    ['empty setup', 'setup\n', 'BEAST1505_EMPTY_SETUP'],
    ['empty module', 'module\n', 'BEAST1506_EMPTY_MODULE']
  ])('reports invalid declaration syntax for %s', (_label, source, code) => {
    const error = getCompileError(source, 'InvalidDeclaration.btsx')
    expect(error.diagnostic.code).toBe(code)
    expect(error.diagnostic.span.start.line).toBe(1)
  })

  test.each([
    ['missing name', 'component\n  p Hi\n', 'BEAST1801_INVALID_COMPONENT_NAME'],
    ['lowercase name', 'component helper\n  p Hi\n', 'BEAST1801_INVALID_COMPONENT_NAME'],
    ['empty body', 'component Helper\np Main\n', 'BEAST1802_EMPTY_COMPONENT'],
    ['missing template', 'component Helper\n  setup const value = 1;\np Main\n', 'BEAST1803_EMPTY_COMPONENT_TEMPLATE']
  ])('reports invalid local component syntax for %s', (_label, source, code) => {
    const error = getCompileError(source, 'InvalidComponent.btsx')
    expect(error.diagnostic.code).toBe(code)
    expect(error.diagnostic.span.start.line).toBe(1)
  })

  test('keeps short parameters inline and preserves embedded expressions', () => {
    const output = compileBeast('if status === "ready"\n  p Ready\n', {
      filename: 'State.btsx',
      propsParam: '{ status }: { status: string }'
    })
    expect(output).toStartWith('export default function State({ status }: { status: string }) @{\n')
    expect(output).toContain('@if (status === "ready") {')
  })

  test('wraps multiple root outputs in a fragment', () => {
    const output = compileBeast('h1 One\np Two\n', { filename: 'Pair.btsx' })
    expect(output).toContain('<>\n\t\t<h1>One</h1>\n\t\t<p>Two</p>\n\t</>')
  })

  test('reports source-located indentation errors', () => {
    expect(() => compileBeast('div\n\tspan Nope\n', { filename: 'bad.btsx' })).toThrow(BeastCompileError)
    try {
      compileBeast('div\n\tspan Nope\n', { filename: 'bad.btsx' })
    } catch (error) {
      expect(error).toBeInstanceOf(BeastCompileError)
      expect((error as BeastCompileError).diagnostic.code).toBe('BEAST1003_TAB_INDENT')
      expect((error as BeastCompileError).diagnostic.span.start.line).toBe(2)
    }
  })

  test('sanitizes component names derived from filenames', () => {
    expect(componentNameFromPath('123-user.card.btsx')).toBe('Beast123UserCard')
  })
})
