"""Run from a Packages checkout: python Matchin/tests/verify.py.

Requires Python playwright and a local Chromium executable. GitHub JSON requests
are served from this checkout; the browser, EDIT events, layout and JavaScript
are real. No user credentials or external writes are used.
"""
import argparse
import hashlib
import http.server
import json
import shutil
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser()
parser.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[2])
parser.add_argument('--output',type=Path,default=Path('work/matchin-verification'))
parser.add_argument('--chromium',default=shutil.which('chromium') or shutil.which('google-chrome'))
args=parser.parse_args()
root=args.repo.resolve();out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
html=root/'Matchin/Matchin-v48-registry-expansion.html'
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(root),**kw)
    def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
errors=[];reads={}
with sync_playwright() as p:
    browser=p.chromium.launch(**({'executable_path':args.chromium} if args.chromium else {}),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000})
    page.on('pageerror',lambda err:errors.append(str(err)))
    def fixture(route):
        url=route.request.url
        if 'api.github.com/' in url:route.fulfill(json={'sha':'f'*40})
        elif 'raw.githubusercontent.com/' in url:
            name=url.split('/',6)[-1];path=root/name
            if path.is_file():
                content=path.read_bytes();reads[name]=hashlib.sha256(content).hexdigest()
                route.fulfill(body=content,content_type='application/json')
            else:route.fulfill(status=404,body=name)
        else:route.continue_()
    page.route('https://**/*',fixture)
    page.goto(f'http://127.0.0.1:{server.server_port}/Matchin/Matchin-v48-registry-expansion.html')
    page.wait_for_function("globalThis.Matchin?.physics.store.status==='ready'")
    report=page.evaluate((root/'Matchin/tests/scenarios.js').read_text())
    report.update(browserErrors=errors,chromiumVersion=browser.version,artifactSHA256=hashlib.sha256(html.read_bytes()).hexdigest(),registryFilesSHA256=reads,
                  fixture='Real Chromium and HTML; GitHub reads use this checkout, synthetic revision f*40. No test result claims a live network load.')
    (out/'verification-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'counts':report['counts'],'browserErrors':errors,'failures':[r for r in report['results'] if r['status']=='FAIL']},ensure_ascii=False,indent=2))
    for name,text,domain in [('cm','23 см',''),('cm2','23 см²',''),('planck','E=hν','quantum_mechanics')]:
        page.evaluate("""({text,domain})=>{const f=Matchin.fields[0];f.physicsSession.resetSelections({includeExplicit:true});f.physicsSession.setContext({domains:domain?[domain]:[]});f.act({type:'REPLACE',start:0,end:f.editor.view().text.length,text});f.act({type:'FOCUS',position:f.editor.view().text.length,exit:true});f.refreshPhysicsUI();}""",{'text':text,'domain':domain})
        page.locator('.measurement-projection').screenshot(path=str(out/(name+'-projection.png')))
    page.set_viewport_size({'width':390,'height':844});page.evaluate("window.dispatchEvent(new Event('resize'))")
    page.screenshot(path=str(out/'mobile.png'),full_page=True)
    browser.close()
server.shutdown()
raise SystemExit(1 if report['counts']['FAIL'] or errors else 0)
