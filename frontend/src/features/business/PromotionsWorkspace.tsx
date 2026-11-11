import {useEffect,useState} from 'react';
import {api,money} from '../../services/api';

type Promotion={
  id:number;
  code:string;
  name:string;
  discountType:'PERCENTAGE'|'FIXED';
  discountValue:number|string;
  minimumSubtotal:number|string;
  startsAt:string;
  endsAt:string;
  maxRedemptions:number|string|null;
  redemptions:number|string;
  active:boolean|number;
};

const localDateTime=(value:string)=>new Date(value).toLocaleString('es-CR',{dateStyle:'short',timeStyle:'short'});
function promotionStatus(promotion:Promotion){
  if(!Boolean(promotion.active))return {label:'Pausada',current:false};
  const now=Date.now();
  if(new Date(promotion.startsAt).getTime()>now)return {label:'Programada',current:false};
  if(new Date(promotion.endsAt).getTime()<=now)return {label:'Vencida',current:false};
  if(promotion.maxRedemptions!==null&&Number(promotion.redemptions)>=Number(promotion.maxRedemptions))return {label:'Agotada',current:false};
  return {label:'Vigente',current:true};
}

export default function PromotionsWorkspace({canManage}:{canManage:boolean}){
  const [promotions,setPromotions]=useState<Promotion[]>([]);
  const [code,setCode]=useState(''),[name,setName]=useState(''),[discountType,setDiscountType]=useState<'PERCENTAGE'|'FIXED'>('PERCENTAGE');
  const [discountValue,setDiscountValue]=useState('10'),[minimumSubtotal,setMinimumSubtotal]=useState('0'),[startsAt,setStartsAt]=useState(''),[endsAt,setEndsAt]=useState(''),[maxRedemptions,setMaxRedemptions]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);

  async function reload(){setPromotions(await api<Promotion[]>('/promotions'));}
  useEffect(()=>{reload().catch(reason=>setError((reason as Error).message));},[]);

  async function createPromotion(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');setNotice('');setBusy(true);
    try{
      await api('/promotions',{method:'POST',body:JSON.stringify({
        code:code.trim().toUpperCase(),name:name.trim(),discountType,discountValue:Number(discountValue),
        minimumSubtotal:Number(minimumSubtotal),startsAt:new Date(startsAt).toISOString(),endsAt:new Date(endsAt).toISOString(),
        maxRedemptions:maxRedemptions?Number(maxRedemptions):null
      })});
      setCode('');setName('');setNotice('Promoción creada. El código ya se puede usar si está vigente.');
      await reload();
    }catch(reason){setError((reason as Error).message);}finally{setBusy(false);}
  }

  async function togglePromotion(promotion:Promotion){
    const active=!Boolean(promotion.active);
    setError('');setNotice('');
    try{
      await api(`/promotions/${promotion.id}`,{method:'PATCH',body:JSON.stringify({active})});
      setNotice(active?'Promoción activada.':'Promoción desactivada.');
      await reload();
    }catch(reason){setError((reason as Error).message);}
  }

  return <section className="business-workspace">
    <div className="business-heading"><div><span className="eyebrow blue">PROMOCIONES DE TIENDA</span><h2>Códigos de descuento</h2><p>El cliente aplica el código en el checkout. No se envían mensajes ni se cambia el precio si no lo solicita.</p></div><span className="business-count">{promotions.length} promociones</span></div>
    {error&&<div className="form-error" role="alert">{error}</div>}{notice&&<div className="business-notice" role="status">{notice}</div>}
    <div className="promo-columns">
      {canManage?<form className="promo-create" onSubmit={createPromotion}>
        <h3>Crear promoción</h3>
        <label>Código<input required minLength={3} maxLength={30} pattern="[A-Za-z0-9_-]+" value={code} onChange={event=>setCode(event.target.value.toUpperCase())} placeholder="SKATE10"/></label>
        <label>Nombre de campaña<input required minLength={2} maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label>
        <div className="promo-fields">
          <label>Tipo<select value={discountType} onChange={event=>setDiscountType(event.target.value as 'PERCENTAGE'|'FIXED')}><option value="PERCENTAGE">Porcentaje</option><option value="FIXED">Monto fijo</option></select></label>
          <label>{discountType==='PERCENTAGE'?'Porcentaje':'Descuento CRC'}<input required type="number" min="0.01" max={discountType==='PERCENTAGE'?'100':undefined} step="0.01" value={discountValue} onChange={event=>setDiscountValue(event.target.value)}/></label>
        </div>
        <label>Subtotal mínimo en CRC<input required type="number" min="0" step="0.01" value={minimumSubtotal} onChange={event=>setMinimumSubtotal(event.target.value)}/></label>
        <div className="promo-fields"><label>Válido desde<input required type="datetime-local" value={startsAt} onChange={event=>setStartsAt(event.target.value)}/></label><label>Válido hasta<input required type="datetime-local" value={endsAt} onChange={event=>setEndsAt(event.target.value)}/></label></div>
        <label>Usos máximos (opcional)<input type="number" min="1" step="1" value={maxRedemptions} onChange={event=>setMaxRedemptions(event.target.value)} placeholder="Sin límite"/></label>
        <button className="button electric" disabled={busy}>{busy?'Guardando…':'Crear código'}</button>
      </form>:<div className="promo-create"><h3>Permiso de consulta</h3><p>Solo una cuenta administradora puede crear, activar o pausar promociones.</p></div>}
      <div className="promo-list">
        <div className="promo-list-heading"><h3>Promociones registradas</h3><span>{promotions.filter(item=>promotionStatus(item).current).length} vigentes</span></div>
        {!promotions.length?<div className="business-empty">No hay promociones creadas.</div>:promotions.map(promotion=><article className="promo-card" key={promotion.id}>
          <div className="promo-card-heading"><div><span className="promo-code">{promotion.code}</span><h4>{promotion.name}</h4></div><span className={`promo-state ${promotionStatus(promotion).current?'active':''}`}>{promotionStatus(promotion).label}</span></div>
          <div className="promo-details"><span>{promotion.discountType==='PERCENTAGE'?`${promotion.discountValue}%`:money(Number(promotion.discountValue))} de descuento</span><span>Mínimo {money(Number(promotion.minimumSubtotal))}</span><span>Usos {promotion.redemptions}{promotion.maxRedemptions===null?'':` / ${promotion.maxRedemptions}`}</span><span>{localDateTime(promotion.startsAt)} — {localDateTime(promotion.endsAt)}</span></div>
          {canManage&&<button type="button" className="button ghost" onClick={()=>togglePromotion(promotion)}>{promotion.active?'Pausar':'Activar'}</button>}
        </article>)}
      </div>
    </div>
  </section>;
}
