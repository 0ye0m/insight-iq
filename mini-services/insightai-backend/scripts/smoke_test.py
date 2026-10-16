#!/usr/bin/env python3
"""
InsightIQ analytics engine smoke tests.
Run: python3 scripts/smoke_test.py
Covers: type detection, quality scoring, plan execution (KPIs incl. derived,
charts), cleaning preview/apply, before/after quality, compare, grounded query.
Exercises the engine through the same stdin/stdout JSON interface the backend uses.
"""

import json
import subprocess
import sys
import os
import tempfile

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(BASE, 'analytics', 'main.py')

PASS = 0
FAIL = 0


def call(payload):
    proc = subprocess.run([sys.executable, MAIN], input=json.dumps(payload), capture_output=True, text=True, timeout=120)
    try:
        out = json.loads(proc.stdout)
    except Exception:
        raise RuntimeError(f'Invalid engine output: {proc.stdout[:300]} stderr: {proc.stderr[:300]}')
    if 'error' in out:
        raise RuntimeError(out['error'])
    return out['data']


def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f'  PASS  {name}')
    else:
        FAIL += 1
        print(f'  FAIL  {name}  {detail}')


# ─── Fixtures ──────────────────────────────────────────────────────────
DIRTY_SALES = """Order ID,Order Date,Customer,Region,Category,Sales,Quantity,Discount
1,2024-01-15, Acme ,North,Electronics,1250.50,2,0.05
2,2024-01-18,Globex,South,Furniture,480.00,1,0.00
3,2024-02-02,Initech,North,Electronics,2100.00,3,0.10
4,2024-02-10, Acme ,East,Stationery,85.25,10,0.00
5,2024-02-22,Umbrella,South,Electronics,3400.00,4,0.15
6,2024-03-05,Globex,West,Furniture,620.75,2,0.00
7,2024-03-14,Initech,North,Stationery,45.50,5,0.00
8,2024-03-21,Stark,East,Electronics,5600.00,6,0.20
9,2024-04-02,Wayne,North,Furniture,980.00,2,0.05
10,2024-04-11,Acme,East,Electronics,1875.25,3,0.00
1,2024-01-15, Acme ,North,Electronics,1250.50,2,0.05
"""

MESSY = """id,name,score,joined
1,Alice,90,2024-01-01
2,Bob,85,2024-01-02
3,,70,2024-01-03
4,Diana,,2024-01-04
5,Eve,95,2024-01-05
5,Eve,95,2024-01-05
"""


def make_csv(content):
    fd, path = tempfile.mkstemp(suffix='.csv')
    with os.fdopen(fd, 'w') as f:
        f.write(content)
    return path


def main():
    print('== 1. Snapshot + profiling ==')
    p1 = make_csv(DIRTY_SALES)
    snap = call({'command': 'snapshot', 'fileId': 'smoke_sales', 'filePath': p1, 'format': '.csv', 'fileName': 'sales.csv'})
    check('tabular detected', snap['fileType'] == 'TABULAR')
    check('11 rows parsed', snap['rowCount'] == 11, snap['rowCount'])
    types = {c['name']: c['semanticType'] for c in snap['profile']['columns']}
    check('Sales is float', types.get('Sales') == 'float', types)
    check('Order Date is datetime', types.get('Order Date') == 'datetime', types)
    q = snap['profile']['quality']
    check('duplicate detected', q['duplicateRows'] == 1, q['duplicateRows'])
    check('whitespace detected', q['whitespaceCells'] >= 3, q['whitespaceCells'])
    check('quality score computed', 0 <= q['qualityScore'] <= 100, q['qualityScore'])

    print('== 2. Plan execution (KPIs, derived, charts, tests) ==')
    plan = {
        'kpis': [
            {'id': 'k1', 'label': 'Total Sales', 'kind': 'aggregate', 'column': 'Sales', 'aggregate': 'sum', 'unit': 'number', 'priority': 1},
            {'id': 'k2', 'label': 'Orders', 'kind': 'aggregate', 'column': 'Order ID', 'aggregate': 'count', 'unit': 'count', 'priority': 2},
            {'id': 'k3', 'label': 'AOV', 'kind': 'derived', 'formula': {'op': 'ratio', 'numerator': {'column': 'Sales', 'aggregate': 'sum'}, 'denominator': {'column': 'Order ID', 'aggregate': 'count'}}, 'unit': 'number', 'priority': 3},
            {'id': 'k4', 'label': 'Sales by Region', 'kind': 'grouped', 'group': {'by': 'Region', 'column': 'Sales', 'aggregate': 'sum', 'limit': 5}, 'unit': 'number', 'priority': 4},
            {'id': 'k5', 'label': 'Zero denom', 'kind': 'derived', 'formula': {'op': 'ratio', 'numerator': {'column': 'Sales', 'aggregate': 'sum'}, 'value': 0}, 'unit': 'number', 'priority': 5},
        ],
        'charts': [
            {'id': 'c1', 'type': 'line', 'title': 'trend', 'x': {'column': 'Order Date', 'bin': 'month'}, 'y': {'column': 'Sales', 'aggregate': 'sum'}, 'limit': 12, 'priority': 1},
            {'id': 'c2', 'type': 'bar', 'title': 'by cat', 'x': {'column': 'Category', 'bin': 'none'}, 'y': {'column': 'Sales', 'aggregate': 'sum'}, 'limit': 10, 'priority': 2},
            {'id': 'c3', 'type': 'histogram', 'title': 'dist', 'x': {'column': 'Sales', 'bin': 'none'}, 'y': {'column': None, 'aggregate': 'count'}, 'limit': 0, 'priority': 3},
            {'id': 'c4', 'type': 'scatter', 'title': 'corr', 'x': {'column': 'Sales', 'bin': 'none'}, 'y': {'column': 'Quantity', 'aggregate': 'none'}, 'limit': 0, 'priority': 4},
            {'id': 'c5', 'type': 'donut', 'title': 'share', 'x': {'column': 'Region', 'bin': 'none'}, 'y': {'column': None, 'aggregate': 'count'}, 'limit': 8, 'priority': 5},
        ],
        'tests': [
            {'id': 't1', 'type': 'correlation', 'columns': ['Sales', 'Quantity'], 'description': 'x'},
        ],
    }
    res = call({'command': 'execute_plan', 'fileId': 'smoke_sales', 'plan': plan})
    kpis = {k['id']: k for k in res['kpis']}
    # fixture contains one duplicated row (1250.50) — engine must count it as-is
    total_sales = (1250.50 + 480.00 + 2100.00 + 85.25 + 3400.00 + 620.75 + 45.50 + 5600.00 + 980.00 + 1875.25) * 1 + 1250.50
    check('sum KPI exact', abs(kpis['k1']['value'] - round(total_sales, 4)) < 0.01, (kpis['k1']['value'], total_sales))
    check('count KPI', kpis['k2']['value'] == 11)
    check('derived AOV = sum/count', abs(kpis['k3']['value'] - round(total_sales / 11, 4)) < 0.01, kpis['k3']['value'])
    check('zero denominator handled', kpis['k5'].get('value') is None and 'denominator' in kpis['k5'].get('error', ''), kpis['k5'])
    grouped = kpis['k4']['result']['groups']
    check('grouped KPI top region East', grouped[0]['name'] == 'East', grouped[:2])
    charts = {c['id']: c for c in res['charts']}
    check('line chart has data', len(charts['c1']['result']['data']) >= 3)
    check('bar chart sums correct', abs(sum(p['y'] for p in charts['c2']['result']['data']) - round(total_sales, 4)) < 0.01)
    check('histogram counts = rows', sum(b['count'] for b in charts['c3']['result']['data']) == 11)
    check('scatter has points', len(charts['c4']['result']['data']) == 11)
    check('donut shares sum ~100', abs(sum(p['share'] for p in charts['c5']['result']['data']) - 100) < 0.5)
    tests = {t['id']: t for t in res['tests']}
    check('correlation computed', tests['t1']['result'].get('correlation') is not None)

    print('== 3. Cleaning preview + apply + quality delta ==')
    preview = call({'command': 'clean_preview', 'fileId': 'smoke_sales'})
    ops = {o['id'] for o in preview['operations']}
    check('duplicate op proposed', 'remove_duplicate_rows' in ops, ops)
    check('whitespace op proposed', 'strip_whitespace' in ops, ops)
    apply_res = call({'command': 'clean_apply', 'fileId': 'smoke_sales', 'operations': ['remove_duplicate_rows', 'strip_whitespace']})
    check('ops applied', set(apply_res['operationsApplied']) == {'remove_duplicate_rows', 'strip_whitespace'}, apply_res['operationsApplied'])
    check('rows reduced by 1', apply_res['rowCountBefore'] - apply_res['rowCountAfter'] == 1)
    check('quality improved', apply_res['after']['qualityScore'] > apply_res['before']['qualityScore'],
          (apply_res['before']['qualityScore'], apply_res['after']['qualityScore']))
    check('duplicates gone after clean', apply_res['after']['duplicateRows'] == 0)

    print('== 4. Compare dirty vs clean ==')
    cmp_res = call({'command': 'compare', 'fileIdA': 'smoke_sales', 'versionA': 1, 'fileIdB': 'smoke_sales', 'versionB': apply_res['appliedVersion'], 'labelA': 'dirty', 'labelB': 'clean'})
    check('quality delta positive', cmp_res['quality']['delta'] > 0, cmp_res['quality'])
    check('row delta = -1', cmp_res['shape']['rowDelta'] == -1)
    check('record match on Order ID', cmp_res['records']['matched'] and cmp_res['records']['keyColumn'] == 'Order ID', cmp_res['records'])

    print('== 5. Grounded queries ==')
    queries = [
        ('what is the total sales', True),
        ('average of Quantity', True),
        ('records per Region', True),
        ('correlation between Sales and Quantity', True),
        ('how many rows', True),
        ('what is the distribution of Region', True),
        ('tell me about quantum physics in the dataset', False),
    ]
    for question, expect_resolved in queries:
        r = call({'command': 'query', 'fileId': 'smoke_sales', 'question': question})
        check(f'query "{question}" -> resolved={expect_resolved}', r.get('resolved') == expect_resolved, r.get('intent'))
    total_q = call({'command': 'query', 'fileId': 'smoke_sales', 'question': 'what is the total sales'})
    # queries run AFTER cleaning (current version) — duplicate already removed
    check('total sales exact (post-clean)', abs(total_q['answer']['value'] - 16437.25) < 0.01, total_q['answer'])

    print('== 6. Missing values + mode fill (second dataset) ==')
    p2 = make_csv(MESSY)
    call({'command': 'snapshot', 'fileId': 'smoke_messy', 'filePath': p2, 'format': '.csv', 'fileName': 'messy.csv'})
    prev2 = call({'command': 'clean_preview', 'fileId': 'smoke_messy'})
    op_ids = [o['id'] for o in prev2['operations']]
    check('fill_missing_mode proposed (name col)', 'fill_missing_mode' in op_ids, op_ids)
    check('fill_missing_median proposed (score col)', 'fill_missing_median' in op_ids, op_ids)
    check('duplicate proposed', 'remove_duplicate_rows' in op_ids)
    app2 = call({'command': 'clean_apply', 'fileId': 'smoke_messy', 'operations': ['fill_missing_mode', 'fill_missing_median', 'remove_duplicate_rows']})
    check('missing reduced to 0', app2['after']['missingCells'] == 0, app2['after']['missingCells'])
    check('dup removed 6->5 rows', app2['rowCountAfter'] == 5, app2['rowCountAfter'])

    print('== 7. Version reset ==')
    versions = call({'command': 'versions', 'fileId': 'smoke_messy'})
    check('multiple versions tracked', len(versions['versions']) >= 2)
    reset = call({'command': 'clean_reset', 'fileId': 'smoke_messy'})
    check('reset to v1', reset.get('currentVersion') == 1, reset)

    print('== 8. Document parsing ==')
    md_fd, md_path = tempfile.mkstemp(suffix='.md')
    with os.fdopen(md_fd, 'w') as f:
        f.write('# Annual Report\n\nRevenue grew 12 percent in fiscal 2024.\n\n## Risks\n\nSupply chain delays remain a concern.\n')
    snap_doc = call({'command': 'snapshot', 'fileId': 'smoke_doc', 'filePath': md_path, 'format': '.md', 'fileName': 'report.md'})
    check('document detected', snap_doc['fileType'] == 'DOCUMENT', snap_doc['fileType'])
    check('chunks created', snap_doc['chunkCount'] >= 1, snap_doc.get('chunkCount'))
    retr = call({'command': 'retrieve', 'fileId': 'smoke_doc', 'question': 'what happened to revenue'})
    check('retrieval finds revenue chunk', len(retr['retrievedChunks']) >= 1, retr['retrievedChunks'][:1])

    print('== 9. Incompatible compare guard ==')
    cmp_bad = call({'command': 'compare', 'fileIdA': 'smoke_sales', 'fileIdB': 'smoke_messy'})
    check('schema diffs reported', len(cmp_bad['schema']['onlyInA']) > 0 and len(cmp_bad['schema']['onlyInB']) > 0)
    check('no false record matching', cmp_bad['records']['matched'] is False, cmp_bad['records'])

    # cleanup
    for fid in ('smoke_sales', 'smoke_messy', 'smoke_doc'):
        d = os.path.join(BASE, 'data', 'processed', fid)
        if os.path.isdir(d):
            import shutil
            shutil.rmtree(d)

    print(f'\nRESULT: {PASS} passed, {FAIL} failed')
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
