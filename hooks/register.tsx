import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { FlameView, ReportRow } from '../types'
import { clientData, flatten, zoomInto, zoomNames } from './layout'
import type { RawNode } from './layout'

const PANE = 'spx-chart'
const METRICS = ['wt', 'ct', 'zm', 'io']
const view = atom({ plugin: 'spx-chart', key: 'view' } as const, null)

const textOf = (res: { content: { type: string; text?: string }[] }) =>
  res.content.map(b => (b.type === 'text' ? (b.text ?? '') : '')).join('')

/** One call to the MCP server; an expired connection gets a single retry. */
async function callMcp($: any, server: string, tool: string, args: Record<string, unknown>) {
  const expired = /invalid or expired session|re-initialize/i
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await $.mcp.call(server, tool, args)
      if (attempt === 0 && res.isError && expired.test(textOf(res))) {
        await $.clock.sleep(500)
        continue
      }
      return res
    } catch (err) {
      if (attempt === 0 && expired.test(String((err as Error).message ?? err))) {
        await $.clock.sleep(500)
        continue
      }
      throw err
    }
  }
}

async function load($: any, server: string, next: Partial<FlameView> & { reportKey: string }) {
  const prev: FlameView | null = await read($, view)
  const base: FlameView = {
    label: '',
    metric: 'wt',
    stack: [],
    zoom: [],
    threshold: 0.01,
    isLoading: true,
    ...(prev && prev.reportKey === next.reportKey ? prev : { list: prev?.list }),
    ...next,
  }
  await update($, view, () => ({ ...base, isLoading: true, error: undefined }))
  try {
    // A big profile can blow the tool-result limit: the engine hands back an
    // "Error: result ... exceeds maximum" text, so prune harder and retry.
    let threshold = base.threshold
    for (let attempt = 0; ; attempt++) {
      const res = await callMcp($, server, 'get_aggregated_call_graph', {
        report_key: base.reportKey,
        metric: base.metric,
        pruning_relative_threshold: threshold,
        root_stack: base.stack,
      })
      const text = textOf(res)
      if (text.trimStart().startsWith('{')) {
        const parsed = JSON.parse(text) as { metric: string; root: RawNode }
        const data = flatten(parsed.root, parsed.metric)
        await update($, view, () => ({ ...base, threshold, zoom: [], isLoading: false, data }))
        return
      }
      if (attempt >= 6 || !/exceeds|too large|maximum/i.test(text)) throw new Error(text.slice(0, 200))
      threshold = Math.min(0.5, threshold * 2.5)
    }
  } catch (err) {
    await update($, view, () => ({ ...base, isLoading: false, error: explain(String((err as Error).message ?? err), server) }))
  }
}

function countFrames(n: { k: unknown[] }): number {
  return 1 + (n.k as { k: unknown[] }[]).reduce((sum, c) => sum + countFrames(c), 0)
}

/** Turns a raw MCP failure into the setup step that fixes it. */
function explain(raw: string, server: string): string {
  if (/invalid or expired session|re-initialize|session (has )?expired/i.test(raw)) {
    return `The MCP connection to "${server}" expired. Reconnect it from /mcp (pick ${server}, reconnect), then run /spx-chart again.`
  }
  if (/denied|permission|rejected/i.test(raw)) {
    return `Permission denied for ${server}. A mod cannot show a prompt, so add "mcp__${server}__*" to permissions.allow in .claude/settings.local.json.`
  }
  if (/not connected|unknown server|no such server|no mcp server|not found|unavailable/i.test(raw)) {
    return `MCP server "${server}" is not connected. Add php-spx-mcp to .mcp.json with env SPX_DATA_DIR set to the reports folder (see the profiling skill), or set this mod's "SPX MCP server" option in /config to the name /mcp lists.`
  }
  return raw.slice(0, 300)
}

async function listReports($: any, server: string, query: string | undefined, limit: number): Promise<ReportRow[]> {
  const res = await callMcp($, server, 'find_reports', { limit, query: query || null })
  const text = textOf(res)
  if (res.isError || !text.trimStart().startsWith('[')) throw new Error(text)
  const rows = JSON.parse(text) as { key: string; descriptor?: string; timestamp?: number; wall_time_ms?: number }[]
  return rows.map(r => ({ key: r.key, label: String(r.descriptor ?? r.key), ts: r.timestamp, wallMs: r.wall_time_ms }))
}

const when = (ts?: number) => (ts ? new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ') : '')
const secs = (ms?: number) => (ms === undefined ? '' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`)

/** One line per report, numbered for `/spx-chart N`. */
function listText(rows: ReportRow[]): string {
  return rows
    .map((r, i) => `${String(i + 1).padStart(2)}  ${when(r.ts)}  ${secs(r.wallMs).padStart(8)}  ${r.label.length > 100 ? r.label.slice(0, 99) + '…' : r.label}`)
    .join('\n')
}

export const register: Register = (on, options) => {
  const server = String(options.mcpServer || 'spx-mcp')

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'spx-chart',
      description: 'Interactive SPX chart chart: /spx-chart [report-key | url-or-command fragment]',
    })
    return next(e)
  })

  on('command.run', { command: 'spx-chart' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'SPX chart' })
    const arg = String((e as any).args ?? '').trim()
    const fail = async (error: string) => {
      await update($, view, () => ({ reportKey: '', label: '', metric: 'wt', stack: [], zoom: [], threshold: 0.01, isLoading: false, error }))
      return { text: `SPX chart: ${error}` }
    }
    try {
      const prev: FlameView | null = await read($, view)
      // no argument: list the recent profilings to pick from
      if (arg === '') {
        const rows = await listReports($, server, undefined, 20)
        if (!rows.length) return await fail(`No SPX reports found. Check that SPX_DATA_DIR in the ${server} entry of .mcp.json points at the folder holding spx-full-*.json (e.g. docroot/sites/default/files/spx/).`)
        await update($, view, () => ({ reportKey: '', label: '', metric: 'wt', stack: [], zoom: [], threshold: 0.01, isLoading: false, list: rows }))
        return { text: `SPX reports (newest first):\n${listText(rows)}\n\nOpen one with /spx-chart N, /spx-chart latest, or /spx-chart <text from its URL or command>.` }
      }
      let target: ReportRow | undefined
      if (/^\d+$/.test(arg)) {
        const rows = prev?.list ?? (await listReports($, server, undefined, 20))
        target = rows[Number(arg) - 1]
        if (!target) return await fail(`No report number ${arg}; run /spx-chart to see the list.`)
      } else if (arg.startsWith('spx-')) {
        target = { key: arg, label: arg }
      } else {
        target = (await listReports($, server, arg === 'latest' ? undefined : arg, 1))[0]
        if (!target) return await fail(`No SPX reports found matching "${arg}".`)
      }
      await load($, server, { reportKey: target.key, label: target.label, stack: [] })
    } catch (err) {
      return await fail(explain(String((err as Error).message ?? err), server))
    }
    const after: FlameView | null = await read($, view)
    if (after?.error) return { text: `SPX chart: ${after.error}` }
    const frames = after?.data ? countFrames(after.data.root) : 0
    return {
      text: `SPX chart: ${after?.reportKey} · ${frames} frames · metric ${after?.metric} · prune ${((after?.threshold ?? 0) * 100).toFixed(2)}%`,
    }
  })

  // Zoom is local: a click re-roots the tree already loaded. A click cannot call the MCP
  // server (a mod's call from there is refused without a permission rule) and does not need to.
  on('ui.message', async ($, e) => {
    const msg = e.data as { type?: string; path?: number[]; n?: number; sig?: string }
    const cur: FlameView | null = await read($, view)
    if (!cur?.data) return {}
    if (msg.type === 'copy' && typeof msg.n === 'number') {
      const name = cur.data.full[msg.n]
      if (name) {
        const done = await $.ui.copy({ text: name, surface: e.surface })
        // success is shown in the chart header; only a failure toasts (a toast shifts the layout)
        if (!done.isCopied) $.ui.toast(`copy failed (${done.reason})`)
      }
    } else if (msg.type === 'zoom' && Array.isArray(msg.path)) {
      // the click was made against the tree the chart showed: ignore it if the zoom has moved on since
      if (msg.sig !== (cur.zoom ?? []).flat().join('.')) return {}
      if (msg.path.length) await update($, view, v => (v ? { ...v, zoom: [...(v.zoom ?? []), msg.path!] } : v))
    } else if (msg.type === 'up') {
      // right-click: back to the previous zoom state, one double-click at a time
      await update($, view, v => (v ? { ...v, zoom: (v.zoom ?? []).slice(0, -1) } : v))
    }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Client, Button } = $.ui.resolve(e) as any
    const cur: FlameView | null = await read($, view)
    // the engine draws the pane's own close X in the top-right corner: keep the first line clear of it
    const reserve = 5
    if (!cur) {
      return (
        <Box paddingRight={reserve}>
          <Text dimColor wrap="truncate">Run /spx-chart to list the profilings.</Text>
        </Box>
      )
    }
    // loading: hide the list and show a spinner in the middle of the pane
    if (cur.isLoading && !cur.data) {
      const rows = Math.max(10, (e.viewport?.rows ?? 30) - 6)
      return (
        <Box flexDirection="column" height={rows} justifyContent="center" alignItems="center">
          <Client key="spinner" module="./spinner.tsx" height={2} props={{ label: 'Loading profile' }} />
          <Text dimColor wrap="truncate">{cur.label.length > 70 ? cur.label.slice(0, 69) + '…' : cur.label}</Text>
        </Box>
      )
    }
    if (cur.list && !cur.data) {
      return (
        <Box flexDirection="column">
          <Box paddingRight={reserve}>
            <Text bold wrap="truncate">SPX profilings, newest first: click one to open it</Text>
          </Box>
          {cur.isLoading && <Text dimColor>loading…</Text>}
          {cur.error && <Text color="red">{cur.error}</Text>}
          {cur.list.map((r, i) => (
            <Button
              key={`report-${i}`}
              plain
              onPress={() => load($, server, { reportKey: r.key, label: r.label, stack: [] })}
            >
              {`${String(i + 1).padStart(2)}  ${when(r.ts)}  ${secs(r.wallMs).padStart(8)}  ${r.label}`}
            </Button>
          ))}
          <Text dimColor>or type /spx-chart N  ·  /spx-chart latest  ·  /spx-chart &lt;text from URL or command&gt;</Text>
        </Box>
      )
    }
    const flat = (cur.zoom ?? []).flat()
    const shown = cur.data ? zoomInto(cur.data, flat) : undefined
    const crumbs = cur.data && flat.length ? ` › ${zoomNames(cur.data, flat).slice(-2).join(' › ')}` : ''
    const trail = [`${cur.label}${crumbs}`, `metric:${cur.metric}`, `prune:${(cur.threshold * 100).toFixed(2)}%`].join('  ·  ')
    const height = Math.max(10, (e.viewport?.rows ?? 30) - 6)
    return (
      <Box flexDirection="column">
        {cur.isLoading && <Text dimColor>loading…</Text>}
        {cur.error && <Text color="red">{cur.error}</Text>}
        {shown && <Client key="flame" module="./flame.tsx" width="100%" height={height} props={{ data: clientData(shown), trail, reserve, sig: flat.join('.') }} />}
      </Box>
    )
  })
}
