#!/usr/bin/env python3
"""Capture a real SPX graph from the project's spx-mcp server (read from .mcp.json)
into hooks/fixtures/real.ts (gitignored: real profiles hold project data) to debug against.

usage: capture-fixture.py [--project DIR] [--threshold 0.02] [--report KEY]
"""
import argparse, json, os, subprocess, sys

ap = argparse.ArgumentParser()
ap.add_argument('--project', default=os.getcwd())
ap.add_argument('--server', default='spx-mcp')
ap.add_argument('--threshold', type=float, default=0.02)
ap.add_argument('--report')
a = ap.parse_args()

cfg = json.load(open(os.path.join(a.project, '.mcp.json')))['mcpServers'][a.server]
proc = subprocess.Popen([cfg['command'], *cfg.get('args', [])], cwd=a.project,
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
_id = 0
def rpc(method, params=None, notify=False):
    global _id
    msg = {'jsonrpc': '2.0', 'method': method, 'params': params or {}}
    if not notify:
        _id += 1; msg['id'] = _id
    proc.stdin.write(json.dumps(msg) + '\n'); proc.stdin.flush()
    if notify: return None
    while True:
        line = proc.stdout.readline()
        if not line: sys.exit('server closed')
        r = json.loads(line)
        if r.get('id') == _id: return r

rpc('initialize', {'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'capture', 'version': '0'}})
rpc('notifications/initialized', notify=True)
call = lambda t, args: rpc('tools/call', {'name': t, 'arguments': args})['result']['content'][0]['text']
reports = call('find_reports', {'limit': 1, 'query': None, 'min_wall_time_ms': 1000})
key = a.report or json.loads(reports)[0]['key']
graph = call('get_aggregated_call_graph', {'report_key': key, 'metric': 'wt', 'pruning_relative_threshold': a.threshold, 'root_stack': []})
assert graph.lstrip().startswith('{'), graph[:200]
proc.terminate()
out = os.path.join(os.path.dirname(__file__), '..', 'hooks', 'fixtures', 'real.ts')
open(out, 'w').write('// captured by scripts/capture-fixture.py from a real SPX report\nexport const reports = %s\nexport const graph = %s\nexport const threshold = %s\n' %
                     (json.dumps(reports), json.dumps(graph), a.threshold))
print('wrote', os.path.normpath(out), len(graph), 'chars, report', key)
