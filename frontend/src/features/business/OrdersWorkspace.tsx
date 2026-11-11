import {useEffect,useState} from 'react';
import {api,money} from '../../services/api';

type ViewMode='cards'|'table';
export type Order={id:number;reference:string;status:string;customerName:string;contact:string;deliveryDetails:string;total:number|string;collected:number|string;customerId:number|null;crmCustomerName:string|null;createdAt:string;promotionCode?:string|null;originalSubtotal?:number|string|null;discount?:number|string|null};
type PaymentEvent={id:number;eventType:'PAYMENT'|'REFUND';amount:number|string;method:string;reference:string;relatedPaymentId:number|null;occurredAt:string;recordedBy:string};

export default function OrdersWorkspace({initialOrders,view,canManagePayments}:{initialOrders:Order[];view:ViewMode;canManagePayments:boolean}){
  const [orders,setOrders]=useState(initialOrders),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>setOrders(initialOrders),[initialOrders]);
  async function reload(){setOrders(await api<Order[]>('/store/orders'));}
  return <section className="business-workspace">
    <div className="business-heading"><div><span className="eyebrow blue">SOLICITUDES COMERCIALES</span><h2>Pedidos y cobros</h2><p>{canManagePayments?'Aceptar un pedido no lo marca como cobrado. Cada cobro o reembolso requiere referencia y queda auditado.':'Los cobros y reembolsos solo están disponibles para Finanzas y Administración.'}</p></div><span className="business-count">{orders.length} pedidos</span></div>
    {error&&<div className="form-error" role="alert">{error}</div>}{notice&&<div className="business-notice" role="status">{notice}</div>}
    {!orders.length?<div className="business-empty">Aún no hay solicitudes de pedido.</div>:<div className={`orders-grid ${view==='table'?'orders-table-view':''}`}>{orders.map(order=><OrderCard key={order.id} order={order} view={view} canManagePayments={canManagePayments} refresh={reload} reportError={setError} reportNotice={setNotice}/>)}</div>}
  </section>;
}

function OrderCard({order,view,canManagePayments,refresh,reportError,reportNotice}:{order:Order;view:ViewMode;canManagePayments:boolean;refresh:()=>Promise<void>;reportError:(message:string)=>void;reportNotice:(message:string)=>void}){
  const [events,setEvents]=useState<PaymentEvent[]|null>(null),[amount,setAmount]=useState(''),[method,setMethod]=useState('TRANSFER'),[reference,setReference]=useState('');
  const [refundId,setRefundId]=useState<number|null>(null),[refundAmount,setRefundAmount]=useState(''),[refundMethod,setRefundMethod]=useState('TRANSFER'),[refundReference,setRefundReference]=useState('');
  const [busy,setBusy]=useState(false);
  async function loadEvents(){setEvents(await api<PaymentEvent[]>(`/store/orders/${order.id}/payments`));}
  async function recordPayment(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();reportError('');reportNotice('');setBusy(true);
    try{
      await api(`/store/orders/${order.id}/payments`,{method:'POST',body:JSON.stringify({amount:Number(amount),method,reference,idempotencyKey:crypto.randomUUID()})});
      setAmount('');setReference('');reportNotice(`Cobro registrado para ${order.reference}.`);await Promise.all([loadEvents(),refresh()]);
    }catch(error){reportError((error as Error).message);}finally{setBusy(false);}
  }
  async function recordRefund(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(refundId===null)return;
    reportError('');reportNotice('');setBusy(true);
    try{
      await api(`/store/orders/${order.id}/refunds`,{method:'POST',body:JSON.stringify({paymentId:refundId,amount:Number(refundAmount),method:refundMethod,reference:refundReference,idempotencyKey:crypto.randomUUID()})});
      setRefundId(null);setRefundAmount('');setRefundReference('');reportNotice(`Reembolso registrado para ${order.reference}.`);await Promise.all([loadEvents(),refresh()]);
    }catch(error){reportError((error as Error).message);}finally{setBusy(false);}
  }
  const statusLabel=order.status==='ACCEPTED'?'Aceptado':order.status==='PENDING'?'Pendiente':'Cancelado';
  return <article className={`order-card ${view==='table'?'order-row':''}`}>
    <div className="order-card-heading"><div><small>{order.reference} · {new Date(order.createdAt).toLocaleDateString('es-CR')}</small><h3>{order.customerName}</h3><span>{order.contact}</span></div><span className={`order-status ${order.status.toLowerCase()}`}>{statusLabel}</span></div>
    <div className="order-facts"><span>Total: <strong>{money(Number(order.total))}</strong></span>{order.promotionCode&&<span>Código {order.promotionCode}: −{money(Number(order.discount||0))} sobre {money(Number(order.originalSubtotal||0))}</span>}<span>Registrado como cobrado: <strong>{money(Number(order.collected))}</strong></span><span>{order.crmCustomerName?`CRM: ${order.crmCustomerName}`:'Sin vínculo CRM'}</span></div>
    {canManagePayments&&order.status==='ACCEPTED'&&<form className="payment-form" onSubmit={recordPayment}>
      <h4>Registrar cobro recibido</h4><p>Solo registra pagos efectivamente recibidos. El servidor valida saldo, permisos e idempotencia.</p>
      <label>Monto<input required type="number" min="0.01" step="0.01" max={Math.max(0,Number(order.total)-Number(order.collected))} value={amount} onChange={event=>setAmount(event.target.value)}/></label>
      <label>Método<select value={method} onChange={event=>setMethod(event.target.value)}><option value="TRANSFER">Transferencia</option><option value="CASH">Efectivo</option><option value="CARD">Tarjeta</option><option value="OTHER">Otro</option></select></label>
      <label>Referencia o comprobante<input required maxLength={120} value={reference} onChange={event=>setReference(event.target.value)}/></label>
      <button className="button electric" disabled={busy||Number(order.total)<=Number(order.collected)}>Guardar cobro</button>
    </form>}
    {canManagePayments&&<button type="button" className="button ghost order-history-button" disabled={busy} onClick={()=>events===null?loadEvents().catch(error=>reportError((error as Error).message)):setEvents(null)}>{events===null?'Ver historial de cobros':'Ocultar historial'}</button>}
    {canManagePayments&&events&&<div className="payment-history">{events.length?events.map(item=><div className="payment-event" key={item.id}>
      <span className={`payment-type ${item.eventType.toLowerCase()}`}>{item.eventType==='PAYMENT'?'Cobro':'Reembolso'}</span><span>{money(Number(item.amount))}</span><span>{item.method} · {item.reference}</span><small>{new Date(item.occurredAt).toLocaleString('es-CR')} · {item.recordedBy}</small>
      {item.eventType==='PAYMENT'&&order.status!=='PENDING'&&<button type="button" className="button ghost" onClick={()=>{setRefundId(item.id);setRefundAmount('');setRefundReference('');}}>Registrar reembolso</button>}
      {refundId===item.id&&<form className="payment-form refund-form" onSubmit={recordRefund}><label>Monto a devolver<input required type="number" min="0.01" step="0.01" max={Number(item.amount)} value={refundAmount} onChange={event=>setRefundAmount(event.target.value)}/></label><label>Método de reembolso<select value={refundMethod} onChange={event=>setRefundMethod(event.target.value)}><option value="TRANSFER">Transferencia</option><option value="CASH">Efectivo</option><option value="CARD">Tarjeta</option><option value="OTHER">Otro</option></select></label><label>Referencia del reembolso<input required maxLength={120} value={refundReference} onChange={event=>setRefundReference(event.target.value)}/></label><button className="button electric" disabled={busy}>Registrar reembolso</button></form>}
    </div>):<p className="business-empty">No hay cobros ni reembolsos registrados.</p>}</div>}
  </article>;
}
