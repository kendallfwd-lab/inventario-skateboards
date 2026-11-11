export type PromotionType='PERCENTAGE'|'FIXED';

export function amountToCents(value:string|number){
  const text=String(value);
  const match=/^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if(!match)throw new RangeError('Monto inválido: usa hasta dos decimales');
  const cents=Number(match[1])*100+Number((match[2]||'').padEnd(2,'0'));
  if(!Number.isSafeInteger(cents))throw new RangeError('Monto inválido');
  return cents;
}

export function promotionDiscountCents(input:{subtotalCents:number;minimumSubtotal:string|number;type:PromotionType;value:string|number}){
  const {subtotalCents,type}=input;
  if(!Number.isSafeInteger(subtotalCents)||subtotalCents<0)throw new RangeError('Subtotal inválido');
  const minimumCents=amountToCents(input.minimumSubtotal);
  const valueCents=amountToCents(input.value);
  if(subtotalCents<minimumCents)throw new RangeError('El subtotal no alcanza el mínimo de la promoción');
  if(valueCents<=0)throw new RangeError('Descuento inválido');
  if(type==='FIXED')return Math.min(valueCents,subtotalCents);
  if(type!=='PERCENTAGE'||valueCents>10000)throw new RangeError('Porcentaje de descuento inválido');
  const discount=Number((BigInt(subtotalCents)*BigInt(valueCents)+5000n)/10000n);
  if(!Number.isSafeInteger(discount))throw new RangeError('Descuento inválido');
  return Math.min(discount,subtotalCents);
}
