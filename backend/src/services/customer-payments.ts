export type PaymentEvent={event_type:'PAYMENT'|'REFUND';amount_crc:string|number};

function toCents(value:string|number){
  const amount=String(value);
  const match=/^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if(!match)throw new Error('Monto inválido en el registro de pagos');
  return Number(match[1])*100+Number((match[2]||'').padEnd(2,'0'));
}

export function collectedCents(events:PaymentEvent[]){
  return events.reduce((total,event)=>total+(event.event_type==='PAYMENT'?toCents(event.amount_crc):-toCents(event.amount_crc)),0);
}

export function outstandingCents(total:string|number,events:PaymentEvent[]){
  const balance=toCents(total)-collectedCents(events);
  if(balance<0)throw new Error('El registro de pagos supera el total del pedido');
  return balance;
}

export function refundRemainingCents(paymentAmount:string|number,refunds:PaymentEvent[]){
  const remaining=toCents(paymentAmount)-refunds.reduce((total,event)=>total+toCents(event.amount_crc),0);
  if(remaining<0)throw new Error('Los reembolsos superan el pago original');
  return remaining;
}
