"""Keep the reviewed CTAVAL calculations; adapt data loading and persistence locally.
The original repo HTML and its email capture process are deliberately untouched.
"""
from pathlib import Path
import re
root=Path(__file__).resolve().parent.parent
source=(root/'alto-valle/source.html').read_text()
source=source[:source.index('// Bootstrap: run loader then init')]+ '</script>\n<script src="/alto-valle/integration.js"></script>\n</body></html>'
source=source.replace('Umbral CVP ($/MWh)','Umbral CVP (USD/MWh)').replace('RMIN cuando CVP &lt; umbral','RMIN cuando CVP &lt; umbral · USD/MWh').replace('RMIN cuando CVP ≥ umbral','RMIN cuando CVP ≥ umbral · USD/MWh')
source=source.replace('</head>','<link rel="stylesheet" href="/alto-valle/integration.css"><link rel="stylesheet" href="/theme.css"></head>')
source=source.replace('fmtFull(cg[m])','fmtFull((cg.byMaq[m]||0)+(cg.byMaqGA[m]||0))')
start=source.index('function buildCostos(){');end=source.index('// ── HEATMAP',start)
source=source[:start]+source[start:end].replace('fmtFull(cg.TOTAL)','fmtFull(cg.TOTAL+cg.TOTAL_GA)').replace('const cRows=getRows(COMBKEYS[m]);','const cRows=getRows(COMBKEYS[m]);').replace('return{m,total};','return{m,total:(cg.byMaq[m]||0)+(cg.byMaqGA[m]||0)};')+source[end:]
# Only the selected month is edited; the API preserves the rest of config.json.
source=source.replace('grid.innerHTML=Object.keys(MONTH_CFG).map(mk=>`','grid.innerHTML=[MONTH].map(mk=>`')
# Remove obsolete personal-token publishing functions in the integrated client.
# The integrated view shares the Contracts palette; calculations are untouched.
colors={'#0d0f14':'#f5f2eb','#151820':'#fcfaf6','#1c2030':'#efede6','#e8eaf0':'#132b46','#7a8099':'#718181','#4a5568':'#718181','#4f8ef7':'#2344b3','#2dd4bf':'#6281cc','#fb923c':'#8c9770','#a78bfa':'#8a9abf','#f472b6':'#a97878','#34d399':'#13755b','#fbbf24':'#94641d','#f87171':'#b45042','#f59e0b':'#94641d','#c4b5fd':'#526f8e','#f97316':'#aa8050','#a855f7':'#6882a0','#6366f1':'#526f8e','#0ea5e9':'#648eb9'}
for old,new in colors.items():source=source.replace(old,new)
source=source.replace("borderColor:'#fff'","borderColor:'#132b46'")
for old,new in [('79,142,247','35,68,179'),('45,212,191','79,143,122'),('52,211,153','19,117,91'),('251,191,36','148,100,29'),('248,113,113','180,80,66'),('255,255,255','22,48,49')]:source=source.replace(old,new)
(root/'alto-valle/index.html').write_text(source)
