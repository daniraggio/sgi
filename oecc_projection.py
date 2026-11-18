"""OECC forecast uses delivered volumes from MATE-OECC and MATP."""
import json,pathlib,math
ROOT=pathlib.Path(__file__).parent
e=json.loads((ROOT/'source_data/oecc_contracts.json').read_text())
p=json.loads((ROOT/'source_data/matp_projection.json').read_text())
def v(sheet,r,c):return sheet[r-1][c-1] if c<=len(sheet[r-1]) else None
def n(sheet,r,c):
 x=v(sheet,r,c)
 return x if isinstance(x,(int,float)) else 0
def col(c):
 result=''
 while c:c,a=divmod(c-1,26);result=chr(65+a)+result
 return result
def energy_price(r,month):
 winter=5<=month<=9
 if r==31:return 60 if winter else 40
 if r==34:return 62 if winter else 45
 if r==35:return 75 if 6<=month<=8 else 70 if month in [5,9] else 45
 price=v(e,r,8)
 if isinstance(price,(int,float)):return price
 return float(price.split('/')[1 if winter else 0].strip())
forecast=[]
for c in range(18,46):
 date=v(e,29,c)[:7];month=int(date[-2:])
 for r in range(30,39):
  q=n(e,r,c)
  if q<=0:continue
  price=energy_price(r,month)
  forecast.append(dict(month=date,kind='energy',client=str(v(e,r,5)).replace('OESC (interco)','OESC'),nemo=str(v(e,r,6)),contract=str(v(e,r,2) or ''),price=price,q=q,revenue=q*price,interco=r in [31,34],intercoTarget='OESC' if r==31 else 'Trading' if r==34 else None,status='Proyección',source=f'Planilla seguimiento · MATE-OECC!{col(c)}{r}'))
for c in range(18,30):
 date=v(p,50,c)[:7];client=None
 for r in range(51,88):
  if v(p,r,5):client=str(v(p,r,5)).strip()
  q=n(p,r,c)
  if q<=0:continue
  if r<=53:continue # OESC end users are aggregated below at the OECC transfer price.
  nemo=v(p,r,6) or ('CINERGOO' if r==85 else '')
  price=v(p,r,8)
  if isinstance(price,str):
   assert r in [67,68,69]
   billed=n(p,r+44,c);fx=n(p,93,c)
   price=billed/q/fx
  assert isinstance(price,(int,float))
  forecast.append(dict(month=date,kind='power',client=client,nemo=str(nemo).strip(),contract=str(v(p,r,4) or ''),price=price,q=q,revenue=q*price,interco=False,intercoTarget=None,status='Proyección',source=f'Planilla seguimiento · MATP!{col(c)}{r}'))
 q=sum(n(p,r,c) for r in [51,52,53])
 if q:forecast.append(dict(month=date,kind='power',client='OESC',nemo='DUKECOMO',contract='',price=13,q=q,revenue=q*13,interco=True,intercoTarget='OESC',status='Proyección',source=f'Planilla seguimiento · MATP!{col(c)}51:{col(c)}53 · OECC→OESC a 13 USD/MW-hrp'))
assert all(o['price']>0 for o in forecast)
for c in range(18,32):
 date=v(e,29,c)[:7]
 assert math.isclose(sum(o['q'] for o in forecast if o['month']==date and o['kind']=='energy'),n(e,44,c),abs_tol=1e-6)
for c in range(18,30):
 date=v(p,50,c)[:7]
 assert math.isclose(sum(o['q'] for o in forecast if o['month']==date and o['kind']=='power'),n(p,88,c),abs_tol=1e-6)
