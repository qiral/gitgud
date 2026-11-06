import type { Commit } from './git'

/** A branch line hidden from the history graph. */
export interface HiddenLine {
  /** The line's id in the full graph (GraphRow.color). */
  color: number
  /** Branch name on the line, or its newest commit's subject. */
  label: string
  /** Commits on it among those loaded. */
  count: number
}

/**
 * The history without the branch lines that the `hidden` commits sit on.
 * Returns the commits that stay, and their (hash, parents) pairs for laying
 * out the graph again, so the remaining lines move over into the room.
 *
 * A line is identified by any one of its commits, which keeps working as
 * more history loads or new commits arrive. The line with HEAD on it can't
 * be hidden, and neither can history it shares with other lines.
 */
export function hideLines(commits: Commit[], hidden: string[]) {
  const byHash = new Map(commits.map((c) => [c.hash, c]))
  const headColor = commits.find((c) => c.refs.some((r) => r.kind === 'head'))
    ?.graph.color
  const shared = sharedHistory(commits, byHash)
  const canHide = (c: Commit) =>
    c.graph.color !== headColor && !shared.has(c.hash)

  const colors = new Set<number>()
  for (const hash of hidden) {
    const c = byHash.get(hash)
    if (c && canHide(c)) colors.add(c.graph.color)
  }
  const isHiddenCommit = (c: Commit) =>
    colors.has(c.graph.color) && !shared.has(c.hash)
  if (colors.size === 0)
    return {
      visible: commits,
      layoutInput: null,
      lines: [] as HiddenLine[],
      canHide,
    }

  const isHidden = (hash: string) => {
    const c = byHash.get(hash)
    return c !== undefined && isHiddenCommit(c)
  }

  // A commit whose own line continues on a hidden one (it branched off it)
  // connects to the first visible commit further down instead.
  const firstVisible = (hash: string) => {
    let cur: string | undefined = hash
    for (let steps = 0; cur && isHidden(cur) && steps < commits.length; steps++)
      cur = byHash.get(cur)?.parents[0]
    return cur && !isHidden(cur) ? cur : null
  }

  const visible = commits.filter((c) => !isHiddenCommit(c))
  const layoutInput: [string, string[]][] = visible.map((c) => {
    const [first, ...rest] = c.parents
    const parents: string[] = []
    const resolved = first === undefined ? null : firstVisible(first)
    if (resolved) parents.push(resolved)
    // Merges of a hidden line are dropped, which is what frees its lane.
    for (const p of rest)
      if (!isHidden(p) && !parents.includes(p)) parents.push(p)
    return [c.hash, parents]
  })

  const lines: HiddenLine[] = [...colors].map((color) => {
    const members = commits.filter(
      (c) => c.graph.color === color && isHiddenCommit(c),
    )
    const branch = members
      .flatMap((c) => c.refs)
      .find((r) => r.kind === 'branch' || r.kind === 'remote')
    return {
      color,
      label: branch?.name ?? members[0].subject,
      count: members.length,
    }
  })

  return { visible, layoutInput, lines, canHide }
}

/**
 * Commits that are also history of another line. The graph colors a commit
 * after the first line that reaches it, so the oldest commits of `main` can
 * carry a feature branch's color; following each line's first parents down
 * finds where it runs into commits colored for some other line.
 */
function sharedHistory(commits: Commit[], byHash: Map<string, Commit>) {
  const shared = new Set<string>()
  for (const c of commits) {
    let parent = c.parents[0] ? byHash.get(c.parents[0]) : undefined
    if (!parent || parent.graph.color === c.graph.color) continue
    // Everything below where this line joins another is shared. Stop at
    // commits already marked, so each commit is walked once.
    while (parent && !shared.has(parent.hash)) {
      shared.add(parent.hash)
      parent = parent.parents[0] ? byHash.get(parent.parents[0]) : undefined
    }
  }
  return shared
}
