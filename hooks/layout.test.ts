import { test, expect } from 'claude-code/testing'

import { PROPS_BUDGET, clientData, flatten, hitTest, layout, pathOf, pathPosOf, sizeOf, zoomInto } from './layout'

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
        { name: 'B::fast', value: 30, calls: 1, children: [{ name: 'C', value: 10, calls: 1, children: [] }] },
      ],
    },
  ],
}

test('layout fills the width and nests by depth', () => {
  const data = flatten(raw, 'wt')
  const rects = layout(data, 100)
  expect(rects[0].w).toBe(100)
  expect(rects.map(r => r.depth)).toEqual([0, 1, 1, 2])
  expect(rects[1].w).toBe(60)
  expect(rects[2].x).toBe(60)
  expect(rects[1].node.s).toBe(60)
})

test('hitTest and pathOf give the zoom path below the synthetic root', () => {
  const data = flatten(raw, 'wt')
  const rects = layout(data, 100)
  const i = hitTest(rects, 65, 2)
  expect(pathOf(data, rects, i)).toEqual(['main', 'B::fast', 'C'])
  expect(hitTest(rects, 5, 5)).toBe(-1)
})

test('frames narrower than a cell are dropped', () => {
  const data = flatten(raw, 'wt')
  expect(layout(data, 5).some(r => r.w < 1)).toBe(false)
})

test('a huge profile with long names stays under the Client props budget', () => {
  const kids = (depth: number, id: string): any[] =>
    depth === 0
      ? []
      : Array.from({ length: 6 }, (_, i) => ({
          name: `Drupal\\Core\\Some\\Very\\Long\\Namespace\\ClassName${id}${i}::someRatherLongMethodName${depth}`,
          value: 1000 + i * 37 + depth,
          calls: 1,
          children: kids(depth - 1, id + i),
        }))
  const big = { name: 'root', value: 0, calls: 0, children: kids(5, 'x') }
  const data = flatten(big, 'wt')
  expect(sizeOf(data)).toBeLessThan(PROPS_BUDGET + 1)
  expect(JSON.stringify(clientData(data)).length).toBeLessThan(100000)
  expect(data.full[data.root.n]).toBe('root')
  expect(layout(data, 120).length).toBeGreaterThan(0)
})

test('zoom lands on the clicked frame even when its name repeats behind a folded wrapper', () => {
  // main > render > wrap > render > {slow 60, fast 40}: the inner `render` is what is clicked, its parent
  // `render` has the same name, and `wrap` is folded away (single child, 100%).
  const mk = (name: string, value: number, children: any[] = []) => ({ name, value, calls: 1, children })
  const raw = mk('root', 0, [
    mk('main', 100, [mk('render', 100, [mk('wrap', 100, [mk('render', 100, [mk('slow', 60), mk('fast', 40)])])])]),
  ])
  const data = flatten(raw, 'wt')
  const rects = layout(data, 100)
  const inner = rects.findIndex(r => r.node.v === 100 && r.node.k.length === 2)
  expect(inner).toBeGreaterThan(0)
  const path = pathPosOf(rects, inner)
  const zoomed = zoomInto(data, path)
  expect(zoomed.root.k.length).toBe(2) // the inner render, with slow and fast under it, not the outer one
  expect(data.names[zoomed.root.n]).toBe('render')
  expect(zoomed.root).toBe(rects[inner]!.node)
  // matching by name instead would have stopped at the outer `render`, one level too high
  const byName = data.root.k[0]!.k.find(c => c.n === rects[inner]!.node.n)
  expect(byName).not.toBe(rects[inner]!.node)
})
