import { test, expect } from 'claude-code/testing'

import { flatten } from './layout'

const raw = {
  name: 'root',
  value: 0,
  calls: 0,
  children: [
    {
      name: 'main',
      value: 100,
      calls: 1,
      children: [
        { name: 'A::slow', value: 60, calls: 3, children: [] },
        { name: 'B::fast', value: 30, calls: 1, children: [] },
      ],
    },
  ],
}

const props: any = {
  title: 'SPX chart',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock',
  scroll: {},
  view: {},
}

test('empty pane draws the hint, not nothing', async $ => {
  const ui: any = await $.ui.mount({
    plugin: 'spx-chart',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'spx-chart',
    props,
    viewport: { columns: 80, rows: 30 },
  } as any)
  expect(await ui.find({ type: 'Text', text: /spx-chart/ })).toBeDefined()
  expect(await ui.find({ key: 'close' })).toBeUndefined() // the engine's own X stays the only close control
  await ui.unmount()
})

test('/spx-chart loads a report, draws the chart and reacts to pointer', async ($, on) => {
  const graph = JSON.stringify({ metric: 'wt', root: raw })
  on('mcp.call', ($, e) => {
    const text = e.tool === 'find_reports' ? JSON.stringify([{ key: 'k1', descriptor: 'GET /x' }]) : graph
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
    viewport: { columns: 80, rows: 30 },
  } as any)
  await ui.resize({ columns: 80, rows: 10, in: 'flame' } as any)
  expect(await ui.find({ text: /main/, in: 'flame' } as any)).toBeDefined()
  await ui.pointer({ type: 'move', x: 5, y: 4 } as any)
  expect(await ui.find({ text: /incl/, in: 'flame' } as any)).toBeDefined()
  await ui.unmount()
})

test('bare /spx-chart lists the profilings and /spx-chart N opens the Nth', async ($, on) => {
  const graph = JSON.stringify({ metric: 'wt', root: raw })
  const rows = [
    { key: 'k1', timestamp: 1790331258, descriptor: '/search?q=a', wall_time_ms: 416750 },
    { key: 'k2', timestamp: 1790331000, descriptor: '/node/1', wall_time_ms: 250 },
  ]
  const asked: string[] = []
  on('mcp.call', ($, e) => {
    if (e.tool === 'get_aggregated_call_graph') asked.push(String(e.args.report_key))
    const text = e.tool === 'find_reports' ? JSON.stringify(rows) : graph
    return { value: { content: [{ type: 'text', text }], isError: false } } as any
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  const listed: any = await $.command.run({ command: 'spx-chart', args: '' } as any)
  expect(JSON.stringify(listed)).toMatch(/\/search\?q=a/)
  expect(JSON.stringify(listed)).toMatch(/\/node\/1/)
  expect(asked.length).toBe(0) // listing loads no graph
  // the pane lists them as buttons: pressing one opens that report
  const ui: any = await $.ui.mount({
    plugin: 'spx-chart',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'spx-chart',
    props,
    viewport: { columns: 100, rows: 30 },
  } as any)
  expect(await ui.find({ key: 'report-1' })).toBeDefined()
  await ui.press({ key: 'report-1' })
  expect(asked).toEqual(['k2'])
  await ui.unmount()
  asked.length = 0
  const opened: any = await $.command.run({ command: 'spx-chart', args: '2' } as any)
  expect(JSON.stringify(opened)).toMatch(/k2/)
  expect(asked).toEqual(['k2'])
})

test('while a report loads the list is replaced by a centred spinner', async ($, on) => {
  let release: () => void = () => {}
  const gate = new Promise<void>(r => (release = r))
  const graph = JSON.stringify({ metric: 'wt', root: raw })
  on('mcp.call', async (_$, e) => {
    if (e.tool === 'get_aggregated_call_graph') await gate
    const text = e.tool === 'find_reports' ? JSON.stringify([{ key: 'k1', descriptor: '/a' }]) : graph
    return { value: { content: [{ type: 'text', text }], isError: false } } as any
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  await $.command.run({ command: 'spx-chart', args: '' } as any)
  const ui: any = await $.ui.mount({
    plugin: 'spx-chart',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'spx-chart',
    props,
    viewport: { columns: 100, rows: 30 },
  } as any)
  expect(await ui.find({ key: 'report-0' })).toBeDefined()
  void ui.press({ key: 'report-0' }) // starts the load, which waits on the gate
  for (let i = 0; i < 20 && !(await ui.find({ key: 'spinner' })); i++) await ui.redraw()
  expect(await ui.find({ key: 'spinner' })).toBeDefined()
  expect(await ui.find({ key: 'report-0' })).toBeUndefined() // the list is hidden
  release()
  await ui.unmount()
})
