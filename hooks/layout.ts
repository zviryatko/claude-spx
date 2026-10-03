import type { FlameData, FlameNode } from '../types'

export type RawNode = {
  name: string
  value: number
  calls: number
  children?: RawNode[]
}

export type Rect = {
  node: FlameNode
  depth: number
  x: number
  w: number
  parent: number
  /** child positions from the previous rect's node down to this one (more than one when wrappers were folded) */
  via: number[]
  /** 0..HEAT_STEPS-1, how much of the whole run this frame spent itself */
  heat: number
}

/** Fixed rows above the chart inside the Client: trail, hovered name, hovered numbers. */
export const HEADER_ROWS = 3
/** A frame with one child covering at least this share of it is folded into its child's row. */
export const PASS_THROUGH = 0.99
export const HEAT_STEPS = 8
export const MAX_NODES = 1200

/** What a Client may be handed: its props are capped near 100k serialized characters. */
export const PROPS_BUDGET = 70000
const NAME_MAX = 80

/** Turns the MCP graph into the compact tree a Client can take as props. */
export function flatten(raw: RawNode, metric: string, maxNodes = MAX_NODES): FlameData {
  const build = (r: RawNode): RawTree => {
    const k = (r.children ?? []).map(build)
    const childSum = k.reduce((sum, c) => sum + c.v, 0)
    const v = r.value > 0 ? r.value : childSum
    return { name: r.name, v, s: Math.max(0, v - childSum), c: r.calls, k }
  }
  const isSynthetic = raw.name === 'root' && raw.value === 0
  let tree = build(raw)
  let threshold = 0
  let data = intern(tree, metric, isSynthetic)
  while ((countRaw(tree) > maxNodes || sizeOf(data) > PROPS_BUDGET) && threshold < 0.5) {
    threshold = threshold === 0 ? 0.001 : threshold * 1.6
    tree = pruneRaw(tree, tree.v * threshold)
    data = intern(tree, metric, isSynthetic)
  }
  return data
}

type RawTree = { name: string; v: number; s: number; c: number; k: RawTree[] }

/** Builds the name tables for exactly the nodes that are left. */
function intern(tree: RawTree, metric: string, isSynthetic: boolean): FlameData {
  const names: string[] = []
  const full: string[] = []
  const index = new Map<string, number>()
  const walk = (t: RawTree): FlameNode => {
    let id = index.get(t.name)
    if (id === undefined) {
      id = names.length
      index.set(t.name, id)
      full.push(t.name)
      names.push(t.name.length > NAME_MAX ? t.name.slice(0, NAME_MAX - 1) + '…' : t.name)
    }
    return { n: id, v: t.v, s: t.s, c: t.c, k: t.k.map(walk) }
  }
  return { names, full, root: walk(tree), metric, isSynthetic }
}

/**
 * What the Client receives. Flat on purpose: props may nest 32 deep at most and a
 * real PHP call stack is deeper, so the tree travels as a preorder list of
 * [nameIndex, value, self, calls, parentRow] and is rebuilt on the other side.
 */
export type FlatData = { names: string[]; nodes: number[][]; metric: string; isSynthetic: boolean }

export function clientData(data: FlameData): FlatData {
  const nodes: number[][] = []
  const walk = (n: FlameNode, parent: number) => {
    const row = nodes.length
    nodes.push([n.n, n.v, n.s, n.c, parent])
    n.k.forEach(c => walk(c, row))
  }
  walk(data.root, -1)
  return { names: data.names, nodes, metric: data.metric, isSynthetic: data.isSynthetic }
}

export function fromFlat(flat: FlatData): FlameData {
  const made = flat.nodes.map(([n, v, s, c]) => ({ n: n!, v: v!, s: s!, c: c!, k: [] as FlameNode[] }))
  flat.nodes.forEach((row, i) => {
    if (row[4]! >= 0) made[row[4]!]!.k.push(made[i]!)
  })
  return { names: flat.names, full: [], root: made[0]!, metric: flat.metric, isSynthetic: flat.isSynthetic }
}

/** Size of what the Client receives. */
export function sizeOf(data: FlameData): number {
  return JSON.stringify(clientData(data)).length
}

function countRaw(n: RawTree): number {
  return 1 + n.k.reduce((sum, c) => sum + countRaw(c), 0)
}

function pruneRaw(n: RawTree, min: number): RawTree {
  return { ...n, k: n.k.filter(c => c.v >= min).map(c => pruneRaw(c, min)) }
}

/**
 * Top-down icicle: one row per depth, width proportional to the metric.
 * Frames narrower than one cell are dropped with their subtree.
 */
export function layout(data: FlameData, columns: number): Rect[] {
  const rects: Rect[] = []
  const total = Math.max(1, data.root.v)
  const place = (node: FlameNode, x0: number, w: number, depth: number, parent: number, via: number[]) => {
    // a wrapper whose only child takes (nearly) all of it adds a row and no information
    const only = node.k[0]
    if (parent >= 0 && node.k.length === 1 && only && only.v >= node.v * PASS_THROUGH) {
      place(only, x0, w, depth, parent, [...via, 0])
      return
    }
    const share = node.s / total
    const heat = Math.min(HEAT_STEPS - 1, Math.floor(Math.sqrt(share * 4) * HEAT_STEPS))
    rects.push({ node, depth, x: x0, w, parent, via, heat })
    const me = rects.length - 1
    spread(node, x0, w, depth + 1, me)
  }
  const spread = (node: FlameNode, x0: number, w: number, depth: number, parent: number) => {
    const scale = w / Math.max(1, node.v)
    let cum = 0
    for (const [ci, child] of node.k.entries()) {
      const start = Math.round(x0 + cum * scale)
      const end = Math.round(x0 + (cum + child.v) * scale)
      cum += child.v
      if (end - start >= 1) place(child, start, end - start, depth, parent, [ci])
    }
  }
  if (data.isSynthetic) spread(data.root, 0, columns, 0, -1)
  else place(data.root, 0, columns, 0, -1, [])
  return rects
}

/** Function names from the outermost visible frame down to rects[i]. */
export function pathOf(data: FlameData, rects: Rect[], i: number): string[] {
  const out: string[] = []
  for (let at = i; at >= 0; at = rects[at].parent) out.unshift(data.names[rects[at].node.n])
  return out
}

/**
 * Child positions from the displayed root down to rects[i], folded wrappers included. Positions, not
 * names: a function name repeats along a stack (recursion), a position in the tree cannot.
 */
export function pathPosOf(rects: Rect[], i: number): number[] {
  const chain: Rect[] = []
  for (let at = i; at >= 0; at = rects[at]!.parent) chain.unshift(rects[at]!)
  return chain.flatMap(r => r.via)
}

export function hitTest(rects: Rect[], x: number, y: number): number {
  return rects.findIndex(r => r.depth === y && x >= r.x && x < r.x + r.w)
}

export function fmtValue(metric: string, v: number): string {
  if (['wt', 'ct', 'it'].includes(metric)) {
    return v >= 1e6 ? `${(v / 1e6).toFixed(2)} s` : v >= 1e3 ? `${(v / 1e3).toFixed(1)} ms` : `${v} µs`
  }
  if (metric.startsWith('z') || metric === 'mor') {
    return v >= 1048576 ? `${(v / 1048576).toFixed(1)} MB` : v >= 1024 ? `${(v / 1024).toFixed(1)} KB` : `${v} B`
  }
  return String(v)
}

/** Cool slate to hot red; each step is a bg colour, text colour is picked for contrast. */
export const HEAT_BG = ['#2b3a4a', '#35566b', '#3f7a7a', '#5f9a5a', '#a3a53c', '#d99a2b', '#e8682a', '#d92b2b']
export const HEAT_FG = ['#c9d6e2', '#e2eef6', '#ffffff', '#101810', '#101810', '#101010', '#101010', '#ffffff']

/** The tree below `zoom` (child positions under the root), drawn as a real root of its own. */
export function zoomInto(data: FlameData, zoom: number[]): FlameData {
  let node = data.root
  for (const pos of zoom) {
    const next = node.k[pos]
    if (!next) break
    node = next
  }
  const isZoomed = node !== data.root
  return { ...data, root: node, isSynthetic: isZoomed ? false : data.isSynthetic }
}

/** Function names along `zoom`, for the breadcrumb. */
export function zoomNames(data: FlameData, zoom: number[]): string[] {
  const out: string[] = []
  let node = data.root
  for (const pos of zoom) {
    const next = node.k[pos]
    if (!next) break
    node = next
    out.push(data.names[node.n] ?? '?')
  }
  return out
}
