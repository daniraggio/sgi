"""Bundle self-contained dashboard and request-scoped GitHub connector Worker."""
from pathlib import Path
import json
R=Path(__file__).parent
assets={}
for route,path,mime in [('/index.html','dist/index.html','text/html; charset=utf-8'),('/contracts.js','contracts.js','text/javascript; charset=utf-8'),('/contracts.css','contracts.css','text/css; charset=utf-8'),('/model.mjs','server/model.mjs','text/javascript; charset=utf-8')]:
 assets[route]={'content':(R/path).read_text(),'type':mime}
model=(R/'server/model.mjs').read_text().replace('export function','function')
handler=(R/'worker/handler.mjs').read_text().replace("import {validateContract,validateGeneration} from '../server/model.mjs';\n",'').replace('export function','function')
out=R/'dist/server';out.mkdir(parents=True,exist_ok=True)
(out/'index.js').write_text(model+'\n'+handler+'\nexport default createHandler('+json.dumps(assets,ensure_ascii=False)+');\n')
