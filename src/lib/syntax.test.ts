import { expect, it } from 'vitest'
import { parseDiff } from './diff'
import {
  diffTokens,
  languageOf,
  loadLanguage,
  paint,
  parseHighlighted,
  tokenizeLines,
} from './syntax'

it('knows languages by extension and name', () => {
  expect(languageOf('src/App.TSX')).toBe('typescript')
  expect(languageOf('docker/Dockerfile')).toBe('dockerfile')
  expect(languageOf('LICENSE')).toBeNull()
  expect(languageOf('constructor')).toBeNull()
  expect(languageOf('a.unknown')).toBeNull()
})

it('reads highlighted code back into lines', () => {
  expect(
    parseHighlighted(
      '<span class="hljs-comment">/* a\nb */</span> x &lt; &#x27;<span class="hljs-title class_">C</span>',
    ),
  ).toEqual([
    [{ text: '/* a', kind: 'comment' }],
    [
      { text: 'b */', kind: 'comment' },
      { text: " x < '", kind: undefined },
      { text: 'C', kind: 'type' },
    ],
  ])
})

it('never changes the text', async () => {
  const lines = [
    '<a href="x">&amp;</a>',
    '',
    '<script>let s = `${1 + "<b>"}`</script>',
    '<style>a{}</style>',
  ]
  await loadLanguage('xml')
  const tokens = tokenizeLines(lines, 'xml')!
  expect(tokens.map((l) => l.map((t) => t.text).join(''))).toEqual(lines)
})

it('reads the old and new side of a hunk on their own', async () => {
  await loadLanguage('typescript')
  const lines = parseDiff(
    [
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,2 +1,2 @@',
      "-const a = '",
      '+const a = 1',
      ' let b',
      '',
    ].join('\n'),
  )
  const tokens = diffTokens(lines, 'typescript')
  const context = lines.find((l) => l.kind === 'context')!
  expect(tokens.get(context.index)![0]).toEqual({
    text: 'let',
    kind: 'keyword',
  })
  expect(tokens.has(lines.find((l) => l.kind === 'hunk')!.index)).toBe(false)
})

it('leaves minified code alone', async () => {
  await loadLanguage('typescript')
  expect(tokenizeLines(['x'.repeat(3000)], 'typescript')).toBeNull()
})

it('combines syntax and word highlights', () => {
  expect(
    paint(
      'const ab',
      [{ text: 'const', kind: 'keyword' }, { text: ' ab' }],
      [
        { text: 'const a', changed: false },
        { text: 'b', changed: true },
      ],
    ),
  ).toEqual([
    { text: 'const', kind: 'keyword', changed: false },
    { text: ' a', kind: undefined, changed: false },
    { text: 'b', kind: undefined, changed: true },
  ])
  // Tokens may stop short of a line's carriage return.
  expect(paint('a\r', [{ text: 'a' }]).map((p) => p.text)).toEqual(['a', '\r'])
})
