import { describe, expect, it } from 'vitest'
import type { Commit, RefLabel } from './git'
import { hideLines } from './lines'

const commit = (
  hash: string,
  parents: string[],
  color: number,
  refs: RefLabel[] = [],
): Commit => ({
  hash,
  shortHash: hash,
  author: 'a',
  email: 'a@x',
  time: 0,
  subject: `subject ${hash}`,
  parents,
  refs,
  graph: { lane: 0, color, width: 1, segments: [] },
})

// main: m3 (merge of feature) -> m2 -> m1
// feature: f2 -> f1, branched off m1
// other: o1 on top of m2, not merged
const HISTORY = [
  commit('o1', ['m2'], 2, [{ name: 'other', kind: 'branch' }]),
  commit('m3', ['m2', 'f2'], 0, [{ name: 'main', kind: 'head' }]),
  commit('f2', ['f1'], 1),
  commit('f1', ['m1'], 1),
  commit('m2', ['m1'], 0),
  commit('m1', [], 0),
]

describe('hideLines', () => {
  it('changes nothing when nothing is hidden', () => {
    const r = hideLines(HISTORY, [])
    expect(r.visible).toBe(HISTORY)
    expect(r.layoutInput).toBeNull()
  })

  it('drops a merged line and the merge edge into it', () => {
    const r = hideLines(HISTORY, ['f1'])
    expect(r.visible.map((c) => c.hash)).toEqual(['o1', 'm3', 'm2', 'm1'])
    expect(r.layoutInput).toEqual([
      ['o1', ['m2']],
      ['m3', ['m2']],
      ['m2', ['m1']],
      ['m1', []],
    ])
    expect(r.lines).toEqual([{ color: 1, label: 'subject f2', count: 2 }])
  })

  it('names a line after its branch', () => {
    expect(hideLines(HISTORY, ['o1']).lines[0].label).toBe('other')
  })

  it('never hides the line HEAD is on', () => {
    expect(hideLines(HISTORY, ['m2']).layoutInput).toBeNull()
  })

  it('keeps history another line shares even when colored for this one', () => {
    // The layout colors m1 after feature, the first line to reach it.
    const h = HISTORY.map((c) =>
      c.hash === 'm1' ? { ...c, graph: { ...c.graph, color: 1 } } : c,
    )
    const r = hideLines(h, ['f2'])
    expect(r.visible.map((c) => c.hash)).toContain('m1')
    expect(r.lines[0].count).toBe(2)
    expect(r.canHide(h.find((c) => c.hash === 'm1')!)).toBe(false)
  })

  it('keeps a line that another branch grew out of', () => {
    const h = [
      commit('g1', ['f2'], 3),
      ...HISTORY.filter((c) => c.hash !== 'o1'),
    ]
    // f2 and f1 are g1's history too, so hiding them would cut g1 off.
    expect(hideLines(h, ['f2']).layoutInput).toBeNull()
    expect(hideLines(h, ['g1']).visible.map((c) => c.hash)).toEqual([
      'm3',
      'f2',
      'f1',
      'm2',
      'm1',
    ])
  })
})
