"""Bundle the dashboard, Access reader, and request-scoped connectors for Sites."""
from pathlib import Path
import json,subprocess
R=Path(__file__).parent
subprocess.run(['python3',str(R/'scripts/build-alto-valle.py')],check=True)
assets={}
assets['/docs/INTEGRACION.md']={'content':(R/'docs/INTEGRACION.md').read_text(),'type':'text/markdown; charset=utf-8'}
for route,path,mime in [('/index.html','dist/index.html','text/html; charset=utf-8'),('/contracts.js','contracts.js','text/javascript; charset=utf-8'),('/contracts.css','contracts.css','text/css; charset=utf-8'),('/model.mjs','server/model.mjs','text/javascript; charset=utf-8'),('/actuals.mjs','server/actuals.mjs','text/javascript; charset=utf-8')]:
 assets[route]={'content':(R/path).read_text(),'type':mime}
for path in ['theme.css','app-shell.html','app-shell.css','app-shell.js','alto-valle/index.html','alto-valle/integration.js','alto-valle/integration.css']:
 assets['/'+path]={'content':(R/path).read_text(),'type':'text/html; charset=utf-8' if path.endswith('.html') else 'text/css; charset=utf-8' if path.endswith('.css') else 'text/javascript; charset=utf-8'}
runtime=R/'.sites-runtime';runtime.mkdir(exist_ok=True)
entry=runtime/'worker-entry.mjs'
entry.write_text("import {createHandler} from '../worker/handler.mjs';\nexport default createHandler("+json.dumps(assets,ensure_ascii=False)+','+(R/'data.json').read_text()+');\n')
out=R/'dist/server';out.mkdir(parents=True,exist_ok=True)
subprocess.run([str(R/'node_modules/.bin/esbuild'),str(entry),'--bundle','--format=esm','--minify','--legal-comments=eof','--platform=browser','--target=es2022','--alias:stream=stream-browserify','--inject:'+str(R/'scripts/buffer-shim.mjs'),'--outfile='+str(out/'index.js')],check=True,cwd=R)
