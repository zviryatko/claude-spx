# claude-spx

An interactive [SPX](https://github.com/NoiseByNorthwest/php-spx) profile chart inside Claude Code: a
heat-coloured icicle (flame) chart in a pane, fed by the
[php-spx-mcp](https://github.com/NoiseByNorthwest/php-spx-mcp) server.

> **Hard dependency: [php-spx-mcp](https://github.com/NoiseByNorthwest/php-spx-mcp).** This plugin is only a
> front end. It reads every profile through that MCP server (by
> [NoiseByNorthwest](https://github.com/NoiseByNorthwest)), which in turn needs the
> [php-spx](https://github.com/NoiseByNorthwest/php-spx) profiler extension writing reports. Without a running,
> connected php-spx-mcp server the plugin has nothing to show. See [Requirements](#requirements).

It is a Claude Code **mod**: a TypeScript function plugin that draws its own UI. Mods are an early-access
feature and the API moves between releases.

## What it does

- `/spx-chart` lists the recent profilings (newest first). Click one in the pane, or run `/spx-chart N`.
- `/spx-chart latest`, `/spx-chart <text from its URL or command>` or `/spx-chart spx-full-…` open a report directly.
- The chart is a top-down icicle: one row per call depth, width proportional to the metric, colour by how much
  time the frame spends **itself** (cool slate, green, yellow, red). Wrapper frames with a single child that
  takes at least 99% of it are folded into one row.
- A fixed three-line header always shows the trail, the hovered function's full name and its
  inclusive / self / calls numbers.
- **Click** a frame to copy its full function name (after a 400 ms wait, so a double-click does not copy), **double-click** to zoom in, **right-click** to go back one
  zoom step.

## Install

```
/plugin marketplace add zviryatko/claude-spx
/plugin install spx-chart@claude-spx
```

or, for one session: `claude --plugin-dir /path/to/claude-spx`.

## Requirements

1. The **[php-spx-mcp](https://github.com/NoiseByNorthwest/php-spx-mcp)** server (requires PHP 8.3+, see its README
   for install) configured in the project's `.mcp.json`, with `SPX_DATA_DIR` pointing at the folder
   that holds the `spx-full-*.json` reports. The mod uses that server and has no folder setting of its own. If
   your server is named differently, set the mod's *SPX MCP server* option (`mcpServer`, default `spx-mcp`).
2. A permission rule for the server's tools, because a mod cannot show a permission prompt. In
   `.claude/settings.local.json`:

   ```json
   { "permissions": { "allow": ["mcp__spx-mcp__*"] } }
   ```

   The five tools are read-only. Without the rule, calls made from a click are refused; the pane then shows
   this exact fix.

## Known limits

- **Expired MCP session.** php-spx-mcp is built on `php-mcp/server`, which expires every session after 3600
  seconds, even over stdio, and cannot recover. After an hour Claude Code's connection goes stale and calls
  fail with `Invalid or expired session`. Reconnect from `/mcp`, or raise the TTL in the server's
  `bin/server.php` (`->withSession('array', $ttlSeconds)`). The mod retries once and says so in the pane.
- Zoom works on the tree already loaded, with no server call. A very large profile is pruned to fit the 100 KB
  limit on a `Client`'s props, so small frames are dropped (the header shows the prune percentage).
- Terminal surface only. The desktop surface would need an `Svg` renderer.
- The metric is `wt` (wall time). Switching it needs a server call from a handler, which needs the permission
  rule above and is not wired up yet.

## Develop

```
scripts/selftest.sh [--project /path/to/project]
```

1. `claude plugin validate`.
2. `claude plugin test`: layout unit tests plus the pane mounted on the terminal surface with a deep synthetic
   report (`hooks/fixtures/synthetic.ts`, a chain deeper than the 32-level props limit), covering the size-limit
   retry, hover, click, double-click and zoom history.
3. A headless `claude -p "/spx-chart"` against the project's real MCP server (needs one configured).

`scripts/capture-fixture.py` captures a real graph into the gitignored `hooks/fixtures/real.ts` for debugging.
Never commit real profiles: they contain URLs, query strings and internal function names.
