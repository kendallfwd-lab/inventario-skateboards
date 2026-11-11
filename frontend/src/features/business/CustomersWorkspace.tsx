import {useEffect,useMemo,useState} from 'react';
import {api} from '../../services/api';

type ViewMode='cards'|'table';
export type Customer={
  id:number;
  codigo:string;
  nombre:string;
  email:string|null;
  telefono:string|null;
  etapa:string;
  notasAdmin?:string|null;
  preferencias?:Record<string,unknown>|null;
  marketingConsent:boolean|number|null;
  paidSalesCount?:number;
  acceptedOrdersCount?:number;
  openFollowupsCount?:number;
  createdAt?:string;
};
type CustomerDetail={
  customer:Customer;
  sales:Array<{referencia:string;estado:string;total:number;fecha:string}>;
  orders:Array<{id:number;reference:string;status:string;total:number;createdAt:string}>;
  followups:Array<{id:number;tipo:string;estado:string;titulo:string;detalle:string|null;dueAt:string|null;assignedTo:string|null;createdBy:string;createdAt:string}>;
  consents:Array<{id:number;granted:boolean|number;channel:string;noticeVersion:string;createdAt:string;recordedBy:string|null}>;
};
const stages=[['NUEVO','Nuevo contacto'],['INTERESADO','Interesado'],['CONTACTADO','Contactado'],['PEDIDO_SOLICITADO','Pedido solicitado'],['CLIENTE','Cliente'],['RECURRENTE','Cliente recurrente'],['INACTIVO','Inactivo']];

export default function CustomersWorkspace({initialCustomers,view}:{initialCustomers:Customer[];view:ViewMode}){
  const [customers,setCustomers]=useState(initialCustomers),[search,setSearch]=useState(''),[selectedId,setSelectedId]=useState<number|null>(null),[detail,setDetail]=useState<CustomerDetail|null>(null);
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState('');
  const [stage,setStage]=useState('NUEVO'),[notes,setNotes]=useState(''),[noticeVersion,setNoticeVersion]=useState('CRM-1'),[channel,setChannel]=useState('WEB');
  const [taskTitle,setTaskTitle]=useState(''),[taskDue,setTaskDue]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const visibleCustomers=useMemo(()=>customers.filter(customer=>`${customer.nombre} ${customer.email||''} ${customer.telefono||''}`.toLowerCase().includes(search.toLowerCase())),[customers,search]);

  useEffect(()=>setCustomers(initialCustomers),[initialCustomers]);
  useEffect(()=>{
    if(!selectedId){setDetail(null);return;}
    let active=true;
    api<CustomerDetail>(`/crm/customers/${selectedId}`).then(value=>{if(active){setDetail(value);setStage(value.customer.etapa);setNotes(value.customer.notasAdmin||'');}}).catch(reason=>{if(active)setError((reason as Error).message);});
    return ()=>{active=false;};
  },[selectedId]);

  async function reload(){
    const updated=await api<Customer[]>('/crm/customers');
    setCustomers(updated);
    if(selectedId)setDetail(await api<CustomerDetail>(`/crm/customers/${selectedId}`));
  }
  async function createCustomer(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');setNotice('');setBusy(true);
    try{
      await api('/crm/customers',{method:'POST',body:JSON.stringify({name,email:email.trim()||undefined,phone:phone.trim()||undefined})});
      setName('');setEmail('');setPhone('');setNotice('Cliente registrado. No se activó consentimiento promocional.');
      await reload();
    }catch(reason){setError((reason as Error).message);}finally{setBusy(false);}
  }
  async function saveProfile(){
    if(!detail)return;
    setError('');setNotice('');setBusy(true);
    try{
      await api(`/crm/customers/${detail.customer.id}`,{method:'PATCH',body:JSON.stringify({stage,notes})});
      setNotice('Perfil actualizado.');await reload();
    }catch(reason){setError((reason as Error).message);}finally{setBusy(false);}
  }
  async function recordConsent(){
    if(!detail)return;
    const granted=!Boolean(detail.customer.marketingConsent);
    if(!window.confirm(granted?'¿Confirmas que el cliente otorgó consentimiento para comunicaciones comerciales?':'¿Confirmas que el cliente retiró su consentimiento?'))return;
    setError('');setNotice('');setBusy(true);
    try{
      await api(`/crm/customers/${detail.customer.id}/consents`,{method:'POST',body:JSON.stringify({granted,channel,noticeVersion})});
      setNotice(granted?'Consentimiento registrado.':'Retiro de consentimiento registrado.');await reload();
    }catch(reason){setError((reason as Error).message);}finally{setBusy(false);}
  }
  async function createFollowup(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!detail)return;
    setError('');setNotice('');setBusy(true);
    try{
      await api(`/crm/customers/${detail.customer.id}/followups`,{method:'POST',body:JSON.stringify({type:'TAREA',title:taskTitle,dueAt:taskDue?new Date(taskDue).toISOString():null})});
      setTaskTitle('');setTaskDue('');setNotice('Seguimiento creado.');await reload();
    }catch(reason){setError((reason as Error).message);}finally{setBusy(false);}
  }
  async function closeFollowup(id:number,status:'COMPLETADO'|'CANCELADO'){
    setError('');setNotice('');
    try{await api(`/crm/followups/${id}`,{method:'PATCH',body:JSON.stringify({status})});await reload();}
    catch(reason){setError((reason as Error).message);}
  }

  return <section className="business-workspace">
    <div className="business-heading"><div><span className="eyebrow blue">CLIENTES Y RELACIONES COMERCIALES</span><h2>CRM</h2><p>Los contactos y seguimientos se guardan en MySQL. El consentimiento comercial inicia desactivado.</p></div><span className="business-count">{customers.length} clientes</span></div>
    {error&&<div className="form-error" role="alert">{error}</div>}{notice&&<div className="business-notice" role="status">{notice}</div>}
    <div className="crm-columns">
      <div className="crm-directory">
        <form className="crm-create" onSubmit={createCustomer}>
          <h3>Registrar cliente</h3>
          <label>Nombre<input required minLength={2} maxLength={160} value={name} onChange={event=>setName(event.target.value)}/></label>
          <label>Correo (opcional)<input type="email" maxLength={190} value={email} onChange={event=>setEmail(event.target.value)}/></label>
          <label>Teléfono (opcional)<input type="tel" maxLength={40} value={phone} onChange={event=>setPhone(event.target.value)}/></label>
          <button className="button electric" disabled={busy}>Guardar cliente</button>
        </form>
        <label className="crm-search">Buscar cliente<input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Nombre, correo o teléfono"/></label>
        <div className={`crm-customer-list ${view==='table'?'crm-list-table':''}`}>
          {visibleCustomers.map(customer=><button type="button" className={`crm-customer ${selectedId===customer.id?'selected':''}`} key={customer.id} onClick={()=>setSelectedId(customer.id)}>
            <span className="crm-avatar">{customer.nombre.trim().slice(0,1).toUpperCase()}</span>
            <span className="crm-customer-main"><strong>{customer.nombre}</strong><small>{customer.email||customer.telefono||'Sin contacto registrado'}</small></span>
            <span className="crm-stage">{stages.find(item=>item[0]===customer.etapa)?.[1]||customer.etapa}</span>
          </button>)}
          {!visibleCustomers.length&&<p className="business-empty">No hay clientes que coincidan con la búsqueda.</p>}
        </div>
      </div>
      <div className="crm-detail">
        {!detail?<div className="business-empty">Selecciona un cliente para consultar su historial y seguimiento.</div>:<>
          <div className="business-heading"><div><span className="eyebrow blue">{detail.customer.codigo}</span><h3>{detail.customer.nombre}</h3><p>{detail.customer.email||'Sin correo'} · {detail.customer.telefono||'Sin teléfono'}</p></div></div>
          <div className="crm-metrics"><span>{detail.sales.filter(sale=>['CONFIRMADA','DEVUELTA'].includes(sale.estado)).length} ventas registradas</span><span>{detail.orders.filter(order=>order.status==='ACCEPTED').length} pedidos aceptados</span><span>{detail.followups.filter(item=>item.estado==='PENDIENTE').length} seguimientos abiertos</span></div>
          <div className="crm-section">
            <h4>Relación comercial</h4>
            <label>Etapa<select value={stage} onChange={event=>setStage(event.target.value)}>{stages.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            <label>Notas administrativas<textarea maxLength={2000} rows={3} value={notes} onChange={event=>setNotes(event.target.value)}/></label>
            <button type="button" className="button ghost" disabled={busy} onClick={saveProfile}>Guardar cambios</button>
          </div>
          <div className="crm-section">
            <h4>Consentimiento comercial</h4>
            <p className={Boolean(detail.customer.marketingConsent)?'consent-enabled':'consent-disabled'}>{Boolean(detail.customer.marketingConsent)?'Consentimiento vigente':'Sin consentimiento para comunicaciones comerciales'}</p>
            <div className="crm-inline-fields"><label>Canal<select value={channel} onChange={event=>setChannel(event.target.value)}><option value="WEB">Web</option><option value="PRESENCIAL">Presencial</option><option value="TELEFONO">Teléfono</option><option value="OTRO">Otro</option></select></label><label>Versión del aviso<input required maxLength={40} value={noticeVersion} onChange={event=>setNoticeVersion(event.target.value)}/></label></div>
            <button type="button" className="button ghost" disabled={busy} onClick={recordConsent}>{Boolean(detail.customer.marketingConsent)?'Registrar retiro de consentimiento':'Registrar consentimiento otorgado'}</button>
            {detail.consents.slice(0,4).map(consent=><small className="crm-history-line" key={consent.id}>{Boolean(consent.granted)?'Otorgado':'Retirado'} · {consent.channel} · aviso {consent.noticeVersion} · {new Date(consent.createdAt).toLocaleDateString('es-CR')}</small>)}
          </div>
          <div className="crm-section">
            <h4>Seguimientos</h4>
            <form className="crm-followup-form" onSubmit={createFollowup}><label>Nueva tarea<input required minLength={2} maxLength={160} value={taskTitle} onChange={event=>setTaskTitle(event.target.value)}/></label><label>Fecha límite (opcional)<input type="datetime-local" value={taskDue} onChange={event=>setTaskDue(event.target.value)}/></label><button className="button electric" disabled={busy}>Crear tarea</button></form>
            {detail.followups.map(item=><div className="crm-followup" key={item.id}><div><strong>{item.titulo}</strong><small>{item.estado} · {item.dueAt?new Date(item.dueAt).toLocaleString('es-CR'):'Sin vencimiento'}{item.assignedTo?` · ${item.assignedTo}`:''}</small></div>{item.estado==='PENDIENTE'&&<button type="button" className="button ghost" onClick={()=>closeFollowup(item.id,'COMPLETADO')}>Completar</button>}</div>)}
          </div>
          <div className="crm-section"><h4>Historial real de ventas y pedidos</h4>{[...detail.sales.map(sale=>({key:`s-${sale.referencia}`,text:`Venta ${sale.referencia} · ${sale.estado} · ${sale.fecha}`})),...detail.orders.map(order=>({key:`o-${order.id}`,text:`Pedido ${order.reference} · ${order.status}`}))].slice(0,12).map(item=><small className="crm-history-line" key={item.key}>{item.text}</small>)}</div>
        </>}
      </div>
    </div>
  </section>;
}
