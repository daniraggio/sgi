"""Reproduce OESC deliveries and the confirmed commercial pricing rules."""
import json,pathlib,math
ROOT=pathlib.Path(__file__).parent
rows=json.loads((ROOT/'source_data/oesc_projection.json').read_text())
history=json.loads((ROOT/'source_data/historical.json').read_text())
def val(r,c):
 v=rows[r-1][c-1]
 return v if isinstance(v,(int,float)) else 0
def raw(r,c):return rows[r-1][c-1]
def col(c):
 t=''
 while c:c,a=divmod(c-1,26);t=chr(65+a)+t
 return t
def sell(r,month):
 client=str(raw(r,5) or '')
 if 'CALSA' in client:return 58
 if 'BEBLAN' in client:return 65 if 5<=month<=9 else 57.5
 if 'AMBAR' in client and r==88 and not 5<=month<=9:return 50
 p=raw(r,8)
 if p=='50 / 71':return 71 if 5<=month<=9 else 50
 if not isinstance(p,(int,float)):raise ValueError(f'Missing selling price in H{r}')
 return p
forecast=[]
for c in range(18,46):
 date=raw(44,c)[:10];year,month=map(int,date[:7].split('-'))
 operations=[]
 def add(supplier,client,nemo,q,p,cp,source,priority=None):
  if q<=1e-9:return
  assert q>=0 and p>=0
  operations.append(dict(supplier=supplier,client=client,nemo=nemo,q=q,price=p,buyprice=cp,income=q*p,cost=q*cp if cp is not None else None,source=source,priority=priority))
 gen=1080 if date[:7]=='2026-10' else val(19,c)
 first_total=sum(val(r,c) for r in range(24,31))
 second_total=sum(val(r,c) for r in range(34,40))
 for r in range(45,58):
  delivered=val(r,c)
  if date[:7]=='2026-10':
   if r<=51:delivered=val(r-21,c)*min(1,gen/first_total) if first_total else 0
   else:delivered=min(val(r-18,c),max(0,gen-first_total)*val(r-18,c)/second_total) if second_total else 0
  add('GSSR',str(raw(r,5)),str(raw(r,6)).replace('\n',' / '),delivered,sell(r,month),None,f'MATE-OESC!{col(c)}{r}'+(' · recalculado con 1.080 MWh' if date[:7]=='2026-10' else ''),val(r,7))
 contracted_q=sum(x['q'] for x in operations)
 if date[:7]!='2026-10':assert abs(contracted_q-val(58,c))<1e-6
 assert contracted_q<=gen+1e-6
 # Same monthly portfolio price rule as GENERADORES in the actuals workbook.
 surplus=max(0,gen-contracted_q)
 add('GSSR','CAMMESA · Spot','SPOT',surplus,40.8,None,f'MATE-OESC!{col(c)}19 − {col(c)}58')
 avg=sum(x['income'] for x in operations)/gen if gen else 0
 buy=min(avg-2.5,avg*.95) if gen else 0
 for x in operations:x['buyprice']=buy;x['cost']=x['q']*buy
 # Chepes: user override of 120 MWh/month for the remaining contract months.
 chepesgen=120 if c<=21 else 0
 q=min(val(11,c),chepesgen)
 add('LEDLAR','BAYER S. A.','BAYEC8ON',q,sell(11,month),54,f'MATE-OESC!{col(c)}11 · escenario usuario: 120 MWh/mes',1)
 for r in [87,88,89]:
  add('Alto Valle',str(raw(r,5)),str(raw(r,6)).replace('\n',' / '),val(r,c),sell(r,month),60 if 5<=month<=9 else 40,f'MATE-OESC!{col(c)}{r}',val(r,7))
 q=sum(x['q'] for x in operations if x['nemo']!='SPOT');revenue=sum(x['income'] for x in operations);cost=sum(x['cost'] for x in operations)
 forecast.append(dict(date=date[:7],year=year,month=month,operations=operations,q=q,spotq=surplus,buyq=q+surplus,revenue=revenue,cost=cost,margin=revenue-cost,solarGeneration=gen,solarPrice=buy,chepesGeneration=chepesgen))
calibration=[]
for c in range(84,92):
 p=history['GSSR'][6][c-1];q=history['GENERADORES'][17][c-1];actual=history['GENERADORES'][19][c-1]
 model=min(p-2.5,p*.95)
 fx=history['Resumen'][62][c-1]
 spotq=history['GENERADORES'][21][c-1] or 0
 spotp=history['GENERADORES'][22][c-1] or 0
 cost=q*model-spotq*spotp
 # February's original formula prices 88.845 MWh separately at CF24.
 special_q=88.845 if c==84 else 0
 if special_q:cost=(q-special_q)*model+special_q*(history['GENERADORES'][23][c-1] or 0)/fx
 actualcost=history['GENERADORES'][24][c-1]/fx
 calibration.append(dict(month=c-82,actualPrice=actual,modelPrice=model,actualCost=actualcost,modelCost=cost,error=cost-actualcost,special=bool(special_q)))
 assert math.isclose(cost,actualcost,abs_tol=.000001)
assert len(forecast)==28
assert math.isclose(sum(x['q'] for x in forecast[0]['operations'] if x['supplier']=='LEDLAR'),120,abs_tol=.000001)
assert next(x for x in forecast if x['date']=='2027-01')['chepesGeneration']==120
assert all(x['cost'] is not None for m in forecast for x in m['operations'])
