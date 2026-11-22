"""Keep the reviewed CTAVAL calculations; adapt data loading and persistence locally.
The original repo HTML and its email capture process are deliberately untouched.
"""
from pathlib import Path
import re
root=Path(__file__).resolve().parent.parent
source=(root/'alto-valle/source.html').read_text()
source=source[:source.index('// Bootstrap: run loader then init')]+ '</script>\n<script src="/alto-valle/integration.js"></script>\n</body></html>'
source=source.replace('Umbral CVP ($/MWh)','Umbral CVP (USD/MWh)').replace('RMIN cuando CVP &lt; umbral','RMIN cuando CVP &lt; umbral · USD/MWh').replace('RMIN cuando CVP ≥ umbral','RMIN cuando CVP ≥ umbral · USD/MWh')
source=source.replace('</head>','<link rel="stylesheet" href="/alto-valle/integration.css"></head>')
source=source.replace('fmtFull(cg[m])','fmtFull((cg.byMaq[m]||0)+(cg.byMaqGA[m]||0))')
start=source.index('function buildCostos(){');end=source.index('// ── HEATMAP',start)
source=source[:start]+source[start:end].replace('fmtFull(cg.TOTAL)','fmtFull(cg.TOTAL+cg.TOTAL_GA)').replace('const cRows=getRows(COMBKEYS[m]);','const cRows=getRows(COMBKEYS[m]);').replace('return{m,total};','return{m,total:(cg.byMaq[m]||0)+(cg.byMaqGA[m]||0)};')+source[end:]
# Only the selected month is edited; the API preserves the rest of config.json.
source=source.replace('grid.innerHTML=Object.keys(MONTH_CFG).map(mk=>`','grid.innerHTML=[MONTH].map(mk=>`')
# Remove obsolete personal-token publishing functions in the integrated client.
(root/'alto-valle/index.html').write_text(source)
