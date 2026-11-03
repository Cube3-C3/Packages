import argparse
import hashlib
import http.server
import json
import shutil
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[2])
parser.add_argument('--suite', choices=['fixes','existing'], default='fixes')
parser.add_argument('--out', type=Path, default=Path('work/matchin-v48.1-results.json'))
parser.add_argument('--screenshot', type=Path)
args = parser.parse_args()
repo = args.repo.resolve()
args.html = repo/'Matchin/Matchin-v48.1-fixed.html'
args.script = repo/('Matchin/tests/fixes-v48.1.js' if args.suite=='fixes' else 'Matchin/tests/scenarios.js')
args.out.parent.mkdir(parents=True, exist_ok=True)
errors, reads, blocked = [], {}, []
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(args.html.resolve().parent), **kw)
    def log_message(self, *a):
        pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1440, 'height':1000})
    page.on('pageerror', lambda e: errors.append(str(e)))
    def fixture(route):
        url = route.request.url
        if 'api.github.com/' in url:
            route.fulfill(json={'sha':'f'*40})
        elif 'raw.githubusercontent.com/' in url:
            name = url.split('/',6)[-1]
            path = repo / name
            if path.is_file():
                body = path.read_bytes()
                reads[name] = hashlib.sha256(body).hexdigest()
                route.fulfill(body=body, content_type='application/json')
            else:
                route.fulfill(status=404, body=name)
        else:
            blocked.append(url)
            route.abort()
    page.route('https://**/*', fixture)
    page.goto(f'http://127.0.0.1:{server.server_port}/{args.html.name}')
    page.wait_for_function("globalThis.Matchin?.physics.store.status==='ready'", timeout=30000)
    report = page.evaluate(args.script.read_text())
    if args.screenshot:
        page.screenshot(path=str(args.screenshot), full_page=True)
    report.update(browserErrors=errors, chromiumVersion=browser.version,
                  artifactSHA256=hashlib.sha256(args.html.read_bytes()).hexdigest(),
                  registryFilesSHA256=reads, blockedRequests=blocked,
                  fixture='Chromium; actual HTML and EDIT. GitHub JSON reads served from the selected checkout with synthetic revision f*40. Live GitHub is a separate check.')
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'counts':report.get('counts'), 'browserErrors':errors,
                      'failures':[r for r in report.get('results',[]) if r.get('status')=='FAIL']}, ensure_ascii=False, indent=2))
    browser.close()
server.shutdown()

raise SystemExit(1 if report.get("counts", {}).get("FAIL") or errors else 0)
