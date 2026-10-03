import type { ClientModule } from 'claude-code'

import type { FlameData } from '../types'
import { HEADER_ROWS, HEAT_BG, HEAT_FG, fmtValue, fromFlat, hitTest, layout, pathPosOf } from './layout'
import type { FlatData, Rect } from './layout'

type Props = { data: FlatData; trail: string; reserve?: number; sig: string }
type State = { hover: number; copiedN?: number }

// The pointer and key listeners are set once; they read the latest drawing from here.
const latest: { data?: FlameData; rects: Rect[]; sig: string } = { rects: [], sig: '' }
const TICK_MS = 50
const DOUBLE_MS = 400
// A first click waits here for DOUBLE_MS: a second click on the same function zooms and the copy never
// happens; otherwise the tick below posts the copy. Counted in frame-clock ticks (by function, not row:
// the layout can shift between the clicks).
let pending: { n: number; ticks: number } | undefined

const short = (name: string) => name.split(/::|\\|\//).filter(Boolean).slice(-2).join('::') || name

const Flame: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const data = fromFlat(props.data)
  const columns = Math.max(20, surface.columns || 100)
  const rects = layout(data, columns)
  const depthMax = rects.reduce((m, r) => Math.max(m, r.depth), 0)
  const avail = Math.max(3, (surface.rows || 24) - HEADER_ROWS)
  const top = 0
  latest.data = data
  latest.rects = rects
  latest.sig = props.sig

  if (surface.state === undefined) {
    surface.every(TICK_MS, () => {
      if (!pending || ++pending.ticks * TICK_MS < DOUBLE_MS) return
      const n = pending.n
      pending = undefined
      surface.post({ type: 'copy', n })
      surface.setState({ hover: surface.state?.hover ?? -1, copiedN: n })
    })
    // y is relative to the whole region, the fixed header rows included
    const at = (x: number, y: number) =>
      y < HEADER_ROWS ? -1 : hitTest(latest.rects, x, y - HEADER_ROWS)
    surface.onPointer(e => {
      if (!latest.data) return
      const i = at(e.x, e.y)
      if (e.type === 'down' && e.button === 'left' && i >= 0) {
        const n = latest.rects[i]!.node.n
        if (pending && pending.n === n) {
          pending = undefined // second click: zoom, and the copy is cancelled
          surface.post({ type: 'zoom', path: pathPosOf(latest.rects, i), sig: latest.sig })
        } else {
          if (pending) surface.post({ type: 'copy', n: pending.n }) // clicked elsewhere: the earlier copy is due now
          pending = { n, ticks: 0 }
        }
      } else if (e.type === 'down' && (e.button === 'right' || e.button === 'middle')) {
        surface.post({ type: 'up' })
      } else if (e.type === 'leave') {
        surface.setState({ hover: -1 })
      } else if (e.type === 'move' || e.type === 'enter') {
        surface.setState({ hover: i, copiedN: i >= 0 && latest.rects[i]?.node.n === surface.state?.copiedN ? surface.state?.copiedN : undefined })
      }
    })
    surface.setState({ hover: -1 })
  }

  const hover = surface.state?.hover ?? -1
  const hovered = hover >= 0 ? rects[hover] : undefined
  const rows = []
  for (let y = top; y < Math.min(depthMax + 1, top + avail); y++) {
    const row = rects.map((r, i) => ({ r, i })).filter(({ r }) => r.depth === y)
    const parts = []
    let cursor = 0
    for (const { r, i } of row) {
      if (r.x > cursor) parts.push(<Text>{' '.repeat(r.x - cursor)}</Text>)
      const label = (' ' + short(data.names[r.node.n] ?? '')).slice(0, r.w).padEnd(r.w, ' ')
      const isHover = i === hover
      parts.push(
        <Text backgroundColor={isHover ? '#ffffff' : HEAT_BG[r.heat]} color={isHover ? '#000000' : HEAT_FG[r.heat]} bold={isHover}>
          {label}
        </Text>,
      )
      cursor = r.x + r.w
    }
    rows.push(<Text wrap="truncate">{parts}</Text>)
  }

  const total = Math.max(1, data.root.v)
  const pct = (v: number) => `${((v / total) * 100).toFixed(1)}%`
  const scrollNote = depthMax + 1 > avail ? `  ·  ${depthMax + 1 - avail} deeper rows hidden: double-click to zoom` : ''
  const name = hovered ? (data.names[hovered.node.n] ?? '') : 'hover a frame; click copies · double-click zooms in · right-click zooms out'
  const stats = hovered
    ? `incl ${fmtValue(data.metric, hovered.node.v)} (${pct(hovered.node.v)})   self ${fmtValue(data.metric, hovered.node.s)} (${pct(hovered.node.s)})   calls ${hovered.node.c}` +
      (hovered && surface.state?.copiedN === hovered.node.n ? '   ✓ copied' : '')
    : ' '

  // Header rows are fixed (one line each, truncated) so the chart always starts at y = HEADER_ROWS.
  return (
    <Box flexDirection="column">
      <Box paddingRight={props.reserve ?? 0}>
        <Text dimColor wrap="truncate">{props.trail + scrollNote}</Text>
      </Box>
      <Text bold wrap="truncate">{name}</Text>
      <Text wrap="truncate">{stats}</Text>
      {rows}
    </Box>
  )
}

export default Flame
