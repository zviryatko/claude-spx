// A deterministic, synthetic SPX call graph shaped like a real Drupal request:
// a long chain of single-child wrappers (deeper than the Client props' 32-level
// limit), then a wide fan-out with long PHP class names. No real project data.
type Raw = { name: string; value: number; calls: number; children: Raw[] }

const wrapper = (i: number) => `Vendor\\Framework\\Runtime\\Layer${i}\\Dispatcher::dispatch`
const leafName = (path: string) => `Drupal\\Core\\Some\\Very\\Long\\Namespace\\Service${path}::someRatherLongMethodName`

function fan(depth: number, path: string, value: number): Raw {
  const children: Raw[] = []
  if (depth > 0) {
    const n = 6
    // a skewed split so some frames are hot and most are small
    const weights = Array.from({ length: n }, (_, i) => 1 / (i + 1) ** 1.6)
    const sum = weights.reduce((a, b) => a + b, 0)
    weights.forEach((w, i) => children.push(fan(depth - 1, `${path}${i}`, Math.floor((value * 0.9 * w) / sum))))
  }
  return { name: leafName(path), value, calls: 1 + (path.length % 7), children }
}

function build(): Raw {
  let node = fan(5, 'X', 1_000_000)
  for (let i = 60; i >= 1; i--) node = { name: wrapper(i), value: 1_000_000, calls: 1, children: [node] }
  node = { name: '/var/www/html/docroot/index.php', value: 1_000_000, calls: 1, children: [node] }
  return { name: 'root', value: 0, calls: 0, children: [node] }
}

export const graph = JSON.stringify({ metric: 'wt', root: build() })
export const reports = JSON.stringify([
  { key: 'spx-full-synthetic-1', timestamp: 1790331258, descriptor: '/search?q=example', wall_time_ms: 416750 },
  { key: 'spx-full-synthetic-2', timestamp: 1790331000, descriptor: '/node/1', wall_time_ms: 250 },
])
export const topName = '/var/www/html/docroot/index.php'
