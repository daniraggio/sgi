export function validateContract(input){
 const text=(k,max=160)=>{if(typeof input[k]!=='string'||!input[k].trim()||input[k].length>max)throw new Error('Completá '+k);return input[k].trim()};
 const number=k=>{const v=input[k];if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw new Error('Valor inválido: '+k);return v};
 const month=k=>{const v=text(k,7);if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(v))throw new Error('Mes inválido');return v};
 const society=text('society'),kind=text('kind');if(!['OESC','OECC'].includes(society)||!['energy','power'].includes(kind))throw new Error('Sociedad o producto inválido');
 const priority=input.priority??null;
 if(priority!==null&&(!Number.isInteger(priority)||priority<1||priority>99))throw new Error("La prioridad debe ser un entero entre 1 y 99");
 const c={society,kind,priority,client:text('client'),nemo:text('nemo'),supplier:text('supplier'),start:month('start'),end:month('end'),volume:number('volume'),summerPrice:number('summerPrice'),winterPrice:number('winterPrice'),active:input.active!==false};
 if(c.start>c.end||months(c.start,c.end).length>120)throw new Error('El plazo debe ser de 1 a 120 meses');
 for(const key of ['monthlyVolumes','monthlyPrices']){c[key]={};if(input[key]&&typeof input[key]==='object'&&!Array.isArray(input[key]))for(const [m,v] of Object.entries(input[key])){if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(m)||m<c.start||m>c.end||typeof v!=='number'||!Number.isFinite(v)||v<0)throw new Error('Detalle mensual inválido');c[key][m]=v;}}
 return c;
}
export function months(start,end){const a=[];for(let y=+start.slice(0,4),m=+start.slice(5);a.length<121;){const s=y+'-'+String(m).padStart(2,'0');if(s>end)break;a.push(s);if(++m===13){m=1;y++}}return a}
export function schedule(c){return c.active?months(c.start,c.end).map(month=>{const q=c.monthlyVolumes[month]??c.volume,price=c.monthlyPrices[month]??((+month.slice(5)>=5&&+month.slice(5)<=9)?c.winterPrice:c.summerPrice);return {month,q,price,income:q*price}}):[]}
