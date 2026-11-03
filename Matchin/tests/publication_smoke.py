import argparse
import shutil
import hashlib
import http.server
import json
import threading
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser()
parser.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[2])
parser.add_argument('--revision',default='694d7879dc982ec1877c91a5ded2f2a6188b9e57')
parser.add_argument('--chromium',default=shutil.which('chromium') or shutil.which('google-chrome'))
args=parser.parse_args()
root=args.repo.resolve()
revision=args.revision
base='https://raw.githubusercontent.com/Cube3-C3/Packages/'+revision+'/'
app='Matchin/Matchin-v48-registry-expansion.html'
reads={};errors=[];checks=[]
def fetch(path):
    with urllib.request.urlopen(base+path,timeout=25) as response:data=response.read()
    sha=hashlib.sha256(data).hexdigest()
    assert sha==hashlib.sha256((root/path).read_bytes()).hexdigest(),'published bytes differ: '+path
    reads[path]={'sha256':sha,'bytes':len(data)}
    return data
published=fetch(app)
checks.append({'name':'published HTML equals the Chromium-tested artifact','status':'PASS','sha256':reads[app]['sha256']})
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200);self.send_header('Content-type','text/html; charset=utf-8');self.end_headers();self.wfile.write(published)
    def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
    browser=p.chromium.launch(**({'executable_path':args.chromium} if args.chromium else {}),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000})
    page.on('pageerror',lambda e:errors.append(str(e)))
    def route(request):
        path=request.request.url.split('/',6)[-1]
        try:request.fulfill(body=fetch(path),content_type='application/json')
        except Exception as error:
            errors.append(str(error));request.fulfill(status=503,body='publication read failed')
    # The browser's outbound HTTPS is serviced by urllib, which uses the managed
    # environment's configured HTTP proxy and CA. Bytes come from GitHub, not fixtures.
    page.route('https://raw.githubusercontent.com/**',route)
    page.goto(f'http://127.0.0.1:{server.server_port}/?ref='+revision)
    page.wait_for_function("globalThis.Matchin?.physics.store.status==='ready'",timeout=60000)
    result=page.evaluate("""()=>{const M=Matchin,f=M.fields[0],set=text=>{f.act({type:'REPLACE',start:0,end:f.editor.view().text.length,text});f.act({type:'FOCUS',position:f.editor.view().text.length,exit:true});f.refreshPhysicsUI();};set('23 см²');const area=M.units.normalized(f.editor.view().tree,M.registry.measurements);f.physicsSession.setContext({domains:['quantum_mechanics']});set('E=hν');const projection=f.measurementProjection.textContent,v=f.editor.view(),self=M.equivalence.evaluate(v.expressionTree,v.expressionTree,undefined,{physicsSession:f.physicsSession,registry:M.registry});set('E=2*hν');const wrong=f.editor.view(),bad=M.equivalence.evaluate(wrong.expressionTree,wrong.expressionTree,undefined,{physicsSession:f.physicsSession,registry:M.registry});return {registryStatus:M.physics.store.status,sourceRevision:M.physics.store.source.revision,area,projection,selfAccepted:self.accepted,wrongAccepted:bad.accepted,structureViewer:!!document.querySelector('.expanded-structure')};}""")
    for name,condition in [
        ('ten registry files read from the published SHA',len(reads)==11 and result['sourceRevision']==revision),
        ('23 square centimetres normalize to 0.0023 square metres',result['area']['value']=='0,0023' and result['area']['power']=='2'),
        ('selected h displays its full exact coefficient', '6,62607015' in result['projection']),
        ('registered Planck law remains accepted',result['selfAccepted']),
        ('wrong Planck coefficient is rejected',not result['wrongAccepted']),
        ('no structure viewer is present',not result['structureViewer']),
        ('no browser or download errors',not errors),
    ]:
        checks.append({'name':name,'status':'PASS' if condition else 'FAIL'})
    browser.close()
server.shutdown()
report={'repository':'Cube3-C3/Packages','revision':revision,'method':'Published HTML downloaded from GitHub and executed locally in Chromium; all ten registry JSON files downloaded from the same GitHub SHA via the managed HTTP proxy. This is repository publication verification, not GitHub Pages deployment.',
        'checks':checks,'reads':reads,'browserErrors':errors,'observed':result}
(root/'Matchin/publication-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'checks':checks,'browserErrors':errors,'files':len(reads)},ensure_ascii=False,indent=2))
raise SystemExit(1 if any(c['status']!='PASS' for c in checks) else 0)
