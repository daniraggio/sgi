"""One-time migration of contractual rows; deliveries remain in data.json."""
import json,pathlib,hashlib,re
R=pathlib.Path(__file__).parent
out=[]
def add(society,supplier,kind,sheet,row,dates,price,source):
 vals={d[:7]:row[i] for i,d in enumerate(dates) if isinstance(d,str) and re.match(r'^20\d{2}-\d{2}',d) and d[:7]>='2026-10' and isinstance(row[i],(int,float)) and row[i]>0}
 if not vals:return
 name=str(row[4] or '').strip().replace('OESC (interco)','OESC');nemo=str(row[5] or '').replace('\n',' / ').strip()
 ident=hashlib.sha256((society+source).encode()).hexdigest()[:16]
 prices={m:price(int(m[-2:])) for m in vals}
 out.append(dict(id=ident,society=society,client=name,nemo=nemo,supplier=supplier,kind=kind,priority=int(row[6]) if isinstance(row[6],(int,float)) and row[6]>=1 else None,start=min(vals),end=max(vals),volume=next(iter(vals.values())),monthlyVolumes=vals,summerPrice=prices.get(next((m for m in vals if int(m[-2:]) not in range(5,10)),''),next(iter(prices.values()))),winterPrice=prices.get(next((m for m in vals if int(m[-2:]) in range(5,10)),''),next(iter(prices.values()))),monthlyPrices=prices,source=source,active=True,imported=True))
o=json.load(open(R/'source_data/oesc_projection.json'))
for rr in [11,*range(24,31),*range(34,40),69,70,71]:
 row=o[rr-1];name=str(row[4]);supplier='LEDLAR' if rr==11 else 'OECC · Alto Valle' if rr>=69 else 'GSSR'
 def price(m):
  winter=5<=m<=9
  if 'CALSA' in name:return 58
  if 'BEBLAN' in name:return 65 if winter else 57.5
  if rr==70:return 67 if winter else 50
  if rr==71:return 71 if winter else 50
  return float(row[7])
 add('OESC',supplier,'energy',o,row,o[43],price,f'MATE-OESC · fila {rr}')
e=json.load(open(R/'source_data/oecc_contracts.json'))
for rr in range(13,22):
 row=e[rr-1]
 if not row[4]:continue
 def price(m):
  w=5<=m<=9
  if rr==14:return 60 if w else 40
  if rr==17:return 62 if w else 45
  if rr==18:return 75 if 6<=m<=8 else 70 if m in [5,9] else 45
  p=row[7];return float(p.split('/')[1 if w else 0]) if isinstance(p,str) else p
 add('OECC','OECC · Alto Valle','energy',e,row,e[11],price,f'MATE-OECC · fila {rr}')
# Power quantities are MW-hrp from the plan, not contracted MW.
p=json.load(open(R/'source_data/matp_projection.json'))
client=''
for rr in range(51,88):
 row=list(p[rr-1]);client=str(row[4]).strip() if row[4] else client;row[4]=client
 if rr==85:row[5]='CINERGOO'
 def price(m):
  raw=row[7]
  return (14 if m in [10,11,12,1] else 13.25) if isinstance(raw,str) else raw
 add('OESC' if rr<54 else 'OECC','OECC · Alto Valle','power',p,row,p[49],price,f'MATP · fila {rr} · MW-hrp previstos')
state=dict(schemaVersion=2,revision=1,contracts=out,audit=[])
(R/'data/state.json').write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n')
print(f'{len(out)} contratos migrados')
