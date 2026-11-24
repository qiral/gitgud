// Syntax highlighting for diffs and blame, with highlight.js. The library and
// each language are only loaded once a file needs them; until then, and for
// languages it doesn't know, code shows without colors.

import { useEffect, useState } from 'react'
import type { HLJSApi, LanguageFn } from 'highlight.js'
import type { Line, Segment } from './diff'

export type SyntaxKind =
  'keyword' | 'string' | 'number' | 'function' | 'type' | 'variable' | 'comment'

/** Classes for each kind; the colors are the theme's, see src/themes.css. */
export const SYNTAX: Record<SyntaxKind, string> = {
  keyword: 'text-syn-keyword',
  string: 'text-syn-string',
  number: 'text-syn-number',
  function: 'text-syn-function',
  type: 'text-syn-type',
  variable: 'text-syn-variable',
  comment: 'text-muted italic',
}

/** Part of a line; without a kind it keeps the text color. */
export interface Token {
  text: string
  kind?: SyntaxKind
}

type Loader = () => Promise<{ default: LanguageFn }>

const LOADERS: Record<string, Loader> = {
  bash: () => import('highlight.js/lib/languages/bash'),
  c: () => import('highlight.js/lib/languages/c'),
  clojure: () => import('highlight.js/lib/languages/clojure'),
  cmake: () => import('highlight.js/lib/languages/cmake'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  css: () => import('highlight.js/lib/languages/css'),
  dart: () => import('highlight.js/lib/languages/dart'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  elixir: () => import('highlight.js/lib/languages/elixir'),
  erlang: () => import('highlight.js/lib/languages/erlang'),
  fsharp: () => import('highlight.js/lib/languages/fsharp'),
  go: () => import('highlight.js/lib/languages/go'),
  graphql: () => import('highlight.js/lib/languages/graphql'),
  groovy: () => import('highlight.js/lib/languages/groovy'),
  haskell: () => import('highlight.js/lib/languages/haskell'),
  ini: () => import('highlight.js/lib/languages/ini'),
  java: () => import('highlight.js/lib/languages/java'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  julia: () => import('highlight.js/lib/languages/julia'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  latex: () => import('highlight.js/lib/languages/latex'),
  less: () => import('highlight.js/lib/languages/less'),
  lua: () => import('highlight.js/lib/languages/lua'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  nix: () => import('highlight.js/lib/languages/nix'),
  objectivec: () => import('highlight.js/lib/languages/objectivec'),
  ocaml: () => import('highlight.js/lib/languages/ocaml'),
  perl: () => import('highlight.js/lib/languages/perl'),
  php: () => import('highlight.js/lib/languages/php'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  protobuf: () => import('highlight.js/lib/languages/protobuf'),
  python: () => import('highlight.js/lib/languages/python'),
  r: () => import('highlight.js/lib/languages/r'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rust: () => import('highlight.js/lib/languages/rust'),
  scala: () => import('highlight.js/lib/languages/scala'),
  scss: () => import('highlight.js/lib/languages/scss'),
  sql: () => import('highlight.js/lib/languages/sql'),
  swift: () => import('highlight.js/lib/languages/swift'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  vim: () => import('highlight.js/lib/languages/vim'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
}

/** Languages that appear inside another, e.g. scripts in HTML. */
const EMBEDS: Record<string, string[]> = {
  xml: ['javascript', 'typescript', 'css', 'scss'],
  php: ['xml'],
  markdown: ['xml'],
}

/** File extensions by language. */
const EXTENSIONS: Record<string, string> = {
  bash: 'sh bash zsh',
  c: 'c h',
  clojure: 'clj cljs cljc edn',
  cmake: 'cmake',
  cpp: 'cc cpp cxx hh hpp hxx ino',
  csharp: 'cs csx',
  css: 'css',
  dart: 'dart',
  dockerfile: 'dockerfile',
  elixir: 'ex exs',
  erlang: 'erl hrl',
  fsharp: 'fs fsi fsx',
  go: 'go',
  graphql: 'graphql gql',
  groovy: 'groovy gradle',
  haskell: 'hs',
  ini: 'ini toml cfg conf properties editorconfig',
  java: 'java',
  javascript: 'js jsx mjs cjs',
  json: 'json jsonc json5 webmanifest',
  julia: 'jl',
  kotlin: 'kt kts',
  latex: 'tex sty',
  less: 'less',
  lua: 'lua',
  makefile: 'mk mak',
  markdown: 'md markdown mdx',
  nix: 'nix',
  objectivec: 'm mm',
  ocaml: 'ml mli',
  perl: 'pl pm',
  php: 'php',
  powershell: 'ps1 psm1',
  protobuf: 'proto',
  python: 'py pyi pyw',
  r: 'r',
  ruby: 'rb rake gemspec',
  rust: 'rs',
  scala: 'scala sbt',
  scss: 'scss',
  sql: 'sql',
  swift: 'swift',
  typescript: 'ts tsx mts cts',
  vim: 'vim',
  xml: 'xml html htm xhtml svg vue svelte plist csproj xaml',
  yaml: 'yml yaml',
}

/** Files known by their whole name. */
const NAMES: Record<string, string> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  'cmakelists.txt': 'cmake',
  gemfile: 'ruby',
  rakefile: 'ruby',
  jenkinsfile: 'groovy',
  'cargo.lock': 'ini',
  'go.mod': 'go',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.gitconfig': 'ini',
  '.vimrc': 'vim',
}

const BY_EXTENSION = new Map(
  Object.entries(EXTENSIONS).flatMap(([language, list]) =>
    list.split(' ').map((ext) => [ext, language] as const),
  ),
)

export function languageOf(path: string): string | null {
  const name = (path.split(/[\\/]/).pop() ?? '').toLowerCase()
  if (Object.keys(NAMES).includes(name)) return NAMES[name]
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  return BY_EXTENSION.get(name.slice(dot + 1)) ?? null
}

let hljs: HLJSApi | null = null
const loading = new Map<string, Promise<void>>()

/** Makes a language ready for tokenizeLines. */
export function loadLanguage(language: string): Promise<void> {
  let ready = loading.get(language)
  if (!ready) {
    ready = (async () => {
      const [core, grammar] = await Promise.all([
        import('highlight.js/lib/core'),
        LOADERS[language](),
        ...(EMBEDS[language] ?? []).map(loadLanguage),
      ])
      hljs = core.default
      hljs.registerLanguage(language, grammar.default)
    })()
    // Not kept when it fails, so it's tried again for the next file.
    ready.catch(() => loading.delete(language))
    loading.set(language, ready)
  }
  return ready
}

const KINDS: Record<string, SyntaxKind> = {
  keyword: 'keyword',
  literal: 'number',
  number: 'number',
  symbol: 'number',
  bullet: 'number',
  string: 'string',
  regexp: 'string',
  'char.escape_': 'number',
  link: 'string',
  code: 'string',
  title: 'function',
  'title.function_': 'function',
  'title.class_': 'type',
  section: 'function',
  type: 'type',
  built_in: 'type',
  class: 'type',
  attr: 'variable',
  attribute: 'variable',
  property: 'variable',
  variable: 'variable',
  'template-variable': 'variable',
  name: 'keyword',
  'selector-tag': 'keyword',
  'selector-class': 'type',
  'selector-id': 'type',
  'selector-attr': 'variable',
  'selector-pseudo': 'variable',
  meta: 'keyword',
  doctag: 'keyword',
  comment: 'comment',
  quote: 'comment',
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
}

/** What a class list like "hljs-title function_" stands for. `null` goes
 *  back to the text color, e.g. for the code inside a template string. */
function kindOf(classes: string): SyntaxKind | null | undefined {
  const name = classes.replace(/^hljs-/, '').replace(/ /g, '.')
  if (name === 'subst' || classes.startsWith('language-')) return null
  return KINDS[name] ?? KINDS[name.split('.')[0]]
}

/** Turns highlight.js output into lines of tokens. It only ever contains
 *  spans with a class, and escaped text. */
export function parseHighlighted(html: string): Token[][] {
  const lines: Token[][] = [[]]
  const stack: (SyntaxKind | undefined)[] = []
  for (const [part, classes] of html.matchAll(
    /<span class="([^"]*)">|<\/span>|[^<]+/g,
  )) {
    if (classes !== undefined) {
      const kind = kindOf(classes)
      stack.push(
        kind === undefined ? stack[stack.length - 1] : (kind ?? undefined),
      )
    } else if (part === '</span>') {
      stack.pop()
    } else {
      const text = part.replace(
        /&(?:amp|lt|gt|quot|#x27);/g,
        (e) => ENTITIES[e],
      )
      const kind = stack[stack.length - 1]
      text.split('\n').forEach((piece, i) => {
        if (i > 0) lines.push([])
        if (piece) lines[lines.length - 1].push({ text: piece, kind })
      })
    }
  }
  return lines
}

/** Colors more code than this would hold up the window for too long. */
const MAX_CODE = 400_000
/** Lines this long are usually minified code. */
const MAX_LINE = 2_000

/** Tokens of each line, or null when they can't or shouldn't be colored. */
export function tokenizeLines(
  lines: string[],
  language: string,
): Token[][] | null {
  if (!hljs?.getLanguage(language)) return null
  if (lines.some((l) => l.length > MAX_LINE)) return null
  const code = lines.map((l) => l.replace(/\r$/, '')).join('\n')
  if (code.length > MAX_CODE) return null
  const out = parseHighlighted(
    hljs.highlight(code, { language, ignoreIllegals: true }).value,
  )
  return out.length === lines.length ? out : null
}

/** Tokens of a diff's lines by their index. Each hunk is read twice, as it
 *  was and as it is now, so a change can't confuse the lines around it.
 *  A comment or string opened above a hunk isn't known about. */
export function diffTokens(
  lines: Line[],
  language: string,
): Map<number, Token[]> {
  const out = new Map<number, Token[]>()
  let size = 0
  const add = (side: Line[]) => {
    for (const l of side) size += l.text.length
    if (size > MAX_CODE) return
    const tokens = tokenizeLines(
      side.map((l) => l.text),
      language,
    )
    tokens?.forEach((t, i) => out.set(side[i].index, t))
  }
  const hunks = new Map<number, Line[]>()
  for (const l of lines) {
    if (l.kind === 'hunk' || l.kind === 'meta') continue
    const hunk = hunks.get(l.hunk)
    if (hunk) hunk.push(l)
    else hunks.set(l.hunk, [l])
  }
  for (const hunk of hunks.values()) {
    if (hunk.some((l) => l.kind === 'remove'))
      add(hunk.filter((l) => l.kind !== 'add'))
    // After the old side, so context lines get the colors of the new one.
    add(hunk.filter((l) => l.kind !== 'remove'))
  }
  return out
}

/** `tokenize` run on `lines` once the language of `path` is there; null until
 *  then and for unknown languages. */
export function useTokens<L, T>(
  path: string | undefined,
  lines: L | undefined,
  tokenize: (lines: L, language: string) => T | null,
): T | null {
  const language = path ? languageOf(path) : null
  const [done, setDone] = useState<{
    lines: L
    language: string
    tokens: T | null
  } | null>(null)
  useEffect(() => {
    if (!language || !lines) return
    let cancelled = false
    loadLanguage(language)
      .then(() => {
        if (cancelled) return
        setDone({ lines, language, tokens: tokenize(lines, language) })
      })
      // Code without colors is fine.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [language, lines, tokenize])
  return done && done.lines === lines && done.language === language
    ? done.tokens
    : null
}

/** Cuts a line wherever its color or its word highlight changes. */
export function paint(
  text: string,
  tokens: Token[] | undefined,
  segments?: Segment[],
): { text: string; kind?: SyntaxKind; changed: boolean }[] {
  const out: { text: string; kind?: SyntaxKind; changed: boolean }[] = []
  let t = 0
  let tEnd = tokens?.[0]?.text.length ?? text.length
  let s = 0
  let sEnd = segments?.[0]?.text.length ?? text.length
  for (let at = 0; at < text.length;) {
    while (tEnd <= at)
      tEnd = tokens?.[++t] ? tEnd + tokens[t].text.length : text.length
    while (sEnd <= at)
      sEnd = segments?.[++s] ? sEnd + segments[s].text.length : text.length
    const end = Math.min(tEnd, sEnd)
    out.push({
      text: text.slice(at, end),
      kind: tokens?.[t]?.kind,
      changed: segments?.[s]?.changed ?? false,
    })
    at = end
  }
  return out
}
