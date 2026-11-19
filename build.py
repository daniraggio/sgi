import json,pathlib
raw=json.load(open(str(pathlib.Path(__file__).parent/'source_data/historical.json')))
def cell(s,r,c):
 v=raw[s][r-1][c-1] if c<=len(raw[s][r-1]) else None
 return v if isinstance(v,(int,float)) else None
def n(s,r,c):return cell(s,r,c) or 0
months=[];ops=[];purchases=[]
clientrows={str(row[2]):i+1 for i,row in enumerate(raw['CLIENTE']) if len(row)>3 and row[3]=='Energía'}
for c in range(84,92):
 m=c-82; fx=n('Resumen',63,c)
 months.append(dict(month=m,fx=fx,q=n('Resumen',23,c)-n('Resumen',8,c)-n('Resumen',9,c),buyq=n('Resumen',50,c),revenue=n('Resumen',43,c)/fx,cost=n('Resumen',57,c)/fx,margin=n('Resumen',60,c)))
 for s,qr,pr,cr in [('LEDLAR',5,7,9),('GSSR',18,20,25),('Alto Valle',59,61,65)]:
  q=n('GENERADORES',qr,c);p=cell('GENERADORES',pr,c)
  if q:purchases.append(dict(month=m,supplier=s,q=q,price=p,gross=q*p,net=n('GENERADORES',cr,c)/fx,source=f'GENERADORES!{chr(65+(c-1)//26-1)}{chr(65+(c-1)%26)}{qr}'))
 for r in range(5,23):
  if r in (8,9):continue  # User confirmed no deliveries to this client.
  row=raw['Resumen'][r-1]; q=n('Resumen',r,c); rev=n('Resumen',r+20,c)/fx
  if not(q or rev):continue
  nemo=str(row[3]);name=str(row[2]).strip();rr=clientrows.get(nemo);price=cell('CLIENTE',rr+1,c) if rr else None
  allocations=[]
  for sheet,supplier in [('LEDLAR (chepes)','LEDLAR'),('GSSR','GSSR'),('CTAV','Alto Valle')]:
   for i,a in enumerate(raw[sheet]):
    if len(a)>3 and a[2]==nemo and a[3]=='Energía':
     aq=n(sheet,i+1,c)
     if aq>0:allocations.append((supplier,aq,f'{sheet}!{i+1}'))
  aq=sum(x[1] for x in allocations)
  for supplier,v,source in allocations:
   cp=next((x['price'] for x in purchases if x['month']==m and x['supplier']==supplier),None)
   income=rev*(v/q) if q else 0
   ops.append(dict(month=m,client=name,nemo=nemo,supplier=supplier,q=v,price=price,income=income,cost=v*cp if cp is not None else None,buyprice=cp,source=source,status='Revisar volumen' if abs(aq-q)>.001 else 'Planilla'))
  if q-aq>.001 or not allocations:
   v=q-aq; income=rev-sum(rev*(x[1]/q) for x in allocations) if q else rev
   ops.append(dict(month=m,client=name,nemo=nemo,supplier='Sin asignar',q=v,price=price,income=income,cost=None,buyprice=None,source=f'Resumen fila {r}',status='Proveedor pendiente'))
spot=dict(month=9,q=n('CLIENTE',188,91),price=n('CLIENTE',189,91),revenue=n('CLIENTE',191,91)/n('Resumen',63,91))
power=[]
for r in [5,6,7]:power.append(dict(nemo=str(raw['POTENCIA'][r-1][2]).strip(),q=n('POTENCIA',r,4),sale=n('POTENCIA',r,5),buy=n('POTENCIA',r+8,5),month=6))
from projection import forecast, calibration
from oecc_projection import forecast as oecc_forecast, col
oecc_actual=json.loads((pathlib.Path(__file__).parent/'source_data/oecc_actual.json').read_text())
for o in oecc_actual:o.update(status='Real',intercoTarget='OESC' if o['interco'] else None)
spot_path=pathlib.Path(__file__).parent/'source_data/oecc_spot_costs.json'
spot_costs=json.loads(spot_path.read_text()) if spot_path.exists() else {}
# Preserve the supplied monthly spots as source; active energy reference is seasonal.
seasonal_costs={m:(60 if 5<=int(m[-2:])<=9 else 40) for m in spot_costs}
matp=json.loads((pathlib.Path(__file__).parent/'source_data/matp_projection.json').read_text())
oesc_power=[]
for c in range(10,30):
 date=matp[49][c-1][:7]
 for rr in [51,52,53]:
  row=matp[rr-1];q=row[c-1] or 0
  if not q:continue
  price=row[7];buyprice=13
  oesc_power.append(dict(date=date,status='Real' if date<'2026-10' else 'Proyección',client=row[4],nemo=row[5],supplier='OECC',q=q,price=price,buyprice=buyprice,income=q*price,cost=q*buyprice,source=f'Planilla seguimiento · MATP!{col(c)}{rr}'))
# One supplier identity for energy from Alto Valle and power from OECC.
for record in ops+purchases+oesc_power+[o for m in forecast for o in m['operations']]:
 if record['supplier'] in ['Alto Valle','OECC']:record['supplier']='OECC · Alto Valle'
e=json.loads((pathlib.Path(__file__).parent/'source_data/oecc_contracts.json').read_text())
oecc_capacity=[]
for c in range(18,46):
 if not isinstance(e[6][c-1],str):continue
 date=e[6][c-1][:7]
 generation=e[7][c-1];commercial=e[8][c-1];contracted=e[26][c-1]
 if not isinstance(generation,(int,float)):continue
 oecc_capacity.append(dict(month=date,generation=generation,commercial=commercial,contracted=contracted,delivered=e[43][c-1],source=f'MATE-OECC!{col(c)}8, {col(c)}9, {col(c)}27, {col(c)}44'))
data=dict(dteSources=json.loads((pathlib.Path(__file__).parent/'source_data/dte_sources.json').read_text()),oeccCapacity=oecc_capacity,oescPower=oesc_power,oeccEnergyCosts=seasonal_costs,oeccSpotCosts=spot_costs,months=months,ops=ops,purchases=purchases,spot=spot,power=power,forecast=forecast,calibration=calibration,oecc=oecc_actual+oecc_forecast)
# CALSA starts in September: preserve gross invoicing and purchase costs;
# recognize the consultant commission separately, once per delivered MWh.
for o in data['ops']:
 if o['month']==9 and o['nemo'] in ['CALSMATY','CALSMCCN']:
  o['commission']=o['q']*6
  o['netIncome']=o['income']-o['commission']
for m in data['months']:
 if m['month']==9:
  m['commission']=sum(o.get('commission',0) for o in data['ops'] if o['month']==9)
  m['margin']-=m['commission']
# Verified October DTE I quantities and the supplied invoicing workbooks.
actual=json.loads((pathlib.Path(__file__).parent/'source_data/october_2026_actuals.json').read_text())
data['actualThrough']=actual['month'];data['actualGeneration']={actual['month']:actual['generation']}
data['months'].append(actual['oescSummary']);data['ops'].extend(actual['oescEnergy'])
data['forecast']=[m for m in data['forecast'] if m['date']>actual['month']]
for m in data['forecast']:
 for o in m['operations']:
  if o['nemo'] in ['CALSMATY','CALSMCCN','CALSMATY / CALSMCCN']:
   o['commission']=o['q']*6;o['price']=64;o['income']+=o['commission']
 m['revenue']=sum(o['income'] for o in m['operations'])

data['oescPower']=[o for o in data['oescPower'] if o['date']!=actual['month']]+actual['oescPower']
data['oecc']=[o for o in data['oecc'] if o['month']!=actual['month']]+actual['oecc']
for g in data['oeccCapacity']:
 if g['month']==actual['month']:g.update(generation=0,commercial=0,delivered=0,source=actual['source'])
for supplier in ['GSSR','LEDLAR']:
 rows=[o for o in actual['oescEnergy'] if o['supplier']==supplier]
 data['purchases'].append(dict(month=10,supplier=supplier,q=sum(o['q'] for o in rows),price=rows[0]['buyprice'],gross=sum(o['cost'] for o in rows),net=sum(o['cost'] for o in rows),source=actual['source']))
(pathlib.Path(__file__).parent/'data.json').write_text(json.dumps(data,ensure_ascii=False))
template=(pathlib.Path(__file__).parent/'template.html').read_text()
template=template.replace('<section id="overview"', (pathlib.Path(__file__).parent/'forecast.html').read_text()+'<section id="overview"')
template=template.replace('<section id="overview"', (pathlib.Path(__file__).parent/'portfolio.html').read_text()+'<section id="overview"')
template=template.replace('<section id="overview"', (pathlib.Path(__file__).parent/'oecc.html').read_text()+'<section id="overview"')
template=template.replace('<section id="overview"', (pathlib.Path(__file__).parent/'oecc_extra.html').read_text()+'<section id="overview"')
template=template.replace('<section id="overview"', (pathlib.Path(__file__).parent/'contracts.html').read_text()+'<section id="overview"')
template=template.replace('<link rel="stylesheet" href="/contracts.css">','<style>'+(pathlib.Path(__file__).parent/'contracts.css').read_text()+'</style>')
template=template.replace('</body>', '<script>'+(pathlib.Path(__file__).parent/'forecast.js').read_text()+'</script><script>'+(pathlib.Path(__file__).parent/'portfolio.js').read_text()+'</script><script>'+(pathlib.Path(__file__).parent/'oecc_view.js').read_text()+'</script><script>'+(pathlib.Path(__file__).parent/'oecc_extra.js').read_text()+'</script><script>'+(pathlib.Path(__file__).parent/'dte_audit.js').read_text()+'</script><script type="module" src="/contracts.js"></script></body>')
(pathlib.Path(__file__).parent/'dist/index.html').write_text(template.replace('__DATA__',json.dumps(data,ensure_ascii=False)))
print(json.dumps({'months':len(months),'operations':len(ops),'margin_usd':sum(x['margin'] for x in months),'mwh':sum(x['q'] for x in months)}))
