export type FlameNode = {
  /** index into FlameData.names */
  n: number
  /** inclusive metric value */
  v: number
  /** exclusive (self) metric value */
  s: number
  /** call count */
  c: number
  k: FlameNode[]
}

export type FlameData = {
  /** display names (truncated), what the chart draws; index = FlameNode.n */
  names: string[]
  /** full function names, same indexes; stays plugin-side, never sent to the Client */
  full: string[]
  root: FlameNode
  metric: string
  /** the root is SPX's synthetic "root": draw its children side by side */
  isSynthetic: boolean
}

export type ReportRow = { key: string; label: string; ts?: number; wallMs?: number }

export type FlameView = {
  /** recent reports shown by a bare /spx-chart; `/spx-chart N` opens the Nth */
  list?: ReportRow[]
  reportKey: string
  label: string
  metric: string
  stack: string[]
  /** local zoom history, one entry per double-click: child positions below the previous root. Right-click pops one. */
  zoom: number[][]
  threshold: number
  isLoading: boolean
  error?: string
  data?: FlameData
}

declare module 'claude-code' {
  interface PluginState {
    'spx-chart': { view: FlameView | null }
  }
}
