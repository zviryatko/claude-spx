import { test, expect } from 'claude-code/testing'

import { graph, reports } from './fixtures/synthetic'

const props: any = { title: 'SPX chart', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: {}, view: {} }
const TOO_BIG = 'Error: result (1,584,361 characters across 4,859 lines) exceeds maximum allowed tokens.'

test('deep report: retries past the size limit, mounts the chart, click copies, double-click zooms locally', async ($, on) => {
  const calls: any[] = []
  on('mcp.call', ($, e) => {
    calls.push(e)
    const text =
      e.tool === 'find_reports' ? reports : (e.args.pruning_relative_threshold as number) < 0.05 ? TOO_BIG : graph
    return { value: { content: [{ type: 'text', text }], isError: false } } as any
  })
  const copies: string[] = []
  on('ui.copy', (_$, e: any) => {
    copies.push(e.text)
    return { value: { isCopied: true } } as any
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)

  const out = await $.command.run({ command: 'spx-chart', args: 'latest' } as any)
  expect(JSON.stringify(out)).toMatch(/frames/)
  const graphCalls = calls.filter(c => c.tool === 'get_aggregated_call_graph')
  expect(graphCalls.length).toBeGreaterThan(1) // it backed off from 1%

  const ui: any = await $.ui.mount({
    plugin: 'spx-chart',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'spx-chart',
    props,
    viewport: { columns: 120, rows: 40 },
  } as any)
  await ui.resize({ columns: 120, rows: 30, in: 'flame' } as any)
  const first = await ui.find({ text: /index\.php/, in: 'flame' } as any)
  expect(first).toBeDefined()

  await ui.pointer({ type: 'move', x: 3, y: 4 } as any)
  expect(await ui.find({ text: /incl/, in: 'flame' } as any)).toBeDefined()

  // regression: hover is relative to the whole Client region, which starts with 3 header rows
  await ui.pointer({ type: 'move', x: 3, y: 0 } as any)
  expect(await ui.find({ text: /incl/, in: 'flame' } as any)).toBeUndefined() // header hits nothing
  await ui.pointer({ type: 'move', x: 3, y: 3 } as any)
  const rowOne = (await ui.find({ text: /index\.php/, in: 'flame' } as any))?.text
  expect(rowOne).toBeDefined() // first chart row is depth 0
  await ui.pointer({ type: 'move', x: 3, y: 6 } as any)
  const hit = await ui.drawn({ in: 'flame' } as any)
  expect(JSON.stringify(hit)).toMatch(/incl/)
  expect(JSON.stringify(hit)).not.toMatch(/"bold":true,"wrap":"truncate"},"children":\["[^"]*index\.php\//) // not row one's name

  const before = calls.length
  // one click copies the full, untruncated name, once the double-click window has passed
  await ui.pointer({ type: 'down', button: 'left', x: 3, y: 5 } as any)
  expect(copies.length).toBe(0)
  await ui.advance(500)
  const top = JSON.parse(graph).root.children[0].name as string
  expect(copies.length).toBe(1)
  expect(copies[0]!.length).toBeGreaterThan(0)
  // two quick clicks on the same frame zoom in, locally: no new MCP call
  await ui.pointer({ type: 'down', button: 'left', x: 3, y: 5 } as any)
  await ui.pointer({ type: 'down', button: 'left', x: 3, y: 5 } as any)
  expect(calls.length).toBe(before)
  expect(await ui.find({ text: /›/, in: 'flame' })).toBeDefined() // trail shows the zoom breadcrumb
  // a second zoom inside it, then right-click goes back ONE step, not all the way
  await ui.pointer({ type: 'down', button: 'left', x: 3, y: 4 })
  await ui.pointer({ type: 'down', button: 'left', x: 3, y: 4 })
  await ui.pointer({ type: 'down', button: 'right', x: 3, y: 4 })
  expect(await ui.find({ text: /›/, in: 'flame' })).toBeDefined()
  await ui.pointer({ type: 'down', button: 'right', x: 3, y: 4 })
  expect(await ui.find({ text: /›/, in: 'flame' })).toBeUndefined()
  expect(top.length).toBeGreaterThan(0)
  await ui.unmount()
})

test('double-click zoom keeps working after a zoom in and out', async ($, on) => {
  on('mcp.call', ($, e) => {
    const text = e.tool === 'find_reports' ? reports : graph
    return { value: { content: [{ type: 'text', text }], isError: false } } as any
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  on('ui.copy', () => ({ value: { isCopied: true } }) as any)
  await $.command.run({ command: 'spx-chart', args: 'latest' } as any)
  const ui: any = await $.ui.mount({
    plugin: 'spx-chart',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'spx-chart',
    props,
    viewport: { columns: 120, rows: 40 },
  } as any)
  await ui.resize({ columns: 120, rows: 30, in: 'flame' } as any)
  const zoomed = async () => (await ui.find({ text: /›/, in: 'flame' })) !== undefined
  for (let round = 0; round < 3; round++) {
    await ui.pointer({ type: 'down', button: 'left', x: 3, y: 5 })
    await ui.pointer({ type: 'down', button: 'left', x: 3, y: 5 })
    expect(await zoomed()).toBe(true) // round `round`
    await ui.pointer({ type: 'down', button: 'right', x: 3, y: 5 })
    expect(await zoomed()).toBe(false)
  }
  await ui.unmount()
})

test('a double-click zooms without copying; a lone click copies after the window', async ($, on) => {
  const copies: string[] = []
  on('ui.copy', (_$, e: any) => {
    copies.push(e.text)
    return { value: { isCopied: true } } as any
  })
  on('mcp.call', ($, e) => {
    const text = e.tool === 'find_reports' ? reports : graph
    return { value: { content: [{ type: 'text', text }], isError: false } } as any
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  await $.command.run({ command: 'spx-chart', args: 'latest' } as any)
  const ui: any = await $.ui.mount({
    plugin: 'spx-chart',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'spx-chart',
    props,
    viewport: { columns: 120, rows: 40 },
  } as any)
  await ui.resize({ columns: 120, rows: 30, in: 'flame' } as any)

  await ui.pointer({ type: 'down', button: 'left', x: 3, y: 5 })
  await ui.advance(150) // inside the window
  await ui.pointer({ type: 'down', button: 'left', x: 3, y: 5 })
  await ui.advance(1000)
  expect(copies.length).toBe(0) // zoomed, never copied
  expect(await ui.find({ text: /›/, in: 'flame' })).toBeDefined()
  await ui.pointer({ type: 'down', button: 'right', x: 3, y: 5 })

  await ui.pointer({ type: 'down', button: 'left', x: 3, y: 5 })
  await ui.advance(200)
  expect(copies.length).toBe(0) // still waiting out the window
  await ui.advance(300)
  expect(copies.length).toBe(1)
  await ui.pointer({ type: 'move', x: 3, y: 5 })
  expect(await ui.find({ text: /✓ copied/, in: 'flame' })).toBeDefined()
  await ui.unmount()
})

test('a stale zoom click is ignored: no history is added and the zoom does not move', async ($, on) => {
  on('mcp.call', ($, e) => {
    const text = e.tool === 'find_reports' ? reports : graph
    return { value: { content: [{ type: 'text', text }], isError: false } } as any
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  on('ui.copy', () => ({ value: { isCopied: true } }) as any)
  await $.command.run({ command: 'spx-chart', args: 'latest' } as any)
  const ui: any = await $.ui.mount({
    plugin: 'spx-chart',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'spx-chart',
    props,
    viewport: { columns: 120, rows: 40 },
  } as any)
  await ui.resize({ columns: 120, rows: 30, in: 'flame' } as any)
  const zoomed = async () => (await ui.find({ text: /›/, in: 'flame' })) !== undefined
  await ui.post({ type: 'zoom', path: [0, 0], sig: 'made-against-another-zoom' }, { in: 'flame' })
  expect(await zoomed()).toBe(false)
  // one right-click now must still be a no-op, i.e. nothing was pushed onto the history
  await ui.pointer({ type: 'down', button: 'right', x: 3, y: 5 })
  expect(await zoomed()).toBe(false)
  await ui.post({ type: 'zoom', path: [0, 0], sig: '' }, { in: 'flame' })
  expect(await zoomed()).toBe(true)
  await ui.unmount()
})
