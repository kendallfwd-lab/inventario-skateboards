import express from 'express';import helmet from 'helmet';import cors from 'cors';import cookieParser from 'cookie-parser';import rateLimit from 'express-rate-limit';import {randomUUID,createHash,randomBytes} from 'node:crypto';import bcrypt from 'bcryptjs';import {z} from 'zod';import {pool} from './db/connection.js';import {env,isAllowedOrigin} from './config/env.js';import {allowRoles,requireAuth,type AuthedRequest,sameOrigin} from './middleware/auth.js';import {createMovement} from './services/stock.js';import {askGemini} from './services/gemini.js';import {overpriceTotal} from './services/purchase-math.js';import {collectedCents,outstandingCents,refundRemainingCents} from './services/customer-payments.js';import {amountToCents,promotionDiscountCents} from './services/promotions.js';
export const app=express();app.disable('x-powered-by');app.use(helmet());app.use(cors({origin:(origin,callback)=>{if(isAllowedOrigin(origin))return callback(null,true);return callback(new Error('Origen no permitido'));},credentials:true}));app.use(express.json({limit:'256kb'}));app.use(cookieParser());app.use((req,res,next)=>{req.headers['x-request-id']??=randomUUID();res.setHeader('X-Request-Id',req.headers['x-request-id'] as string);next();});app.use(sameOrigin);app.use('/api/auth/login',rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:true,legacyHeaders:false}));
const asyncRoute=(fn:any)=>(req:any,res:any,next:any)=>Promise.resolve(fn(req,res,next)).catch(next);
const cartItemsSchema=z.array(z.object({variantId:z.coerce.number().int().positive(),quantity:z.coerce.number().int().positive().max(20)})).min(1).max(20).refine(items=>new Set(items.map(item=>item.variantId)).size===items.length,'No repitas variantes en el carrito');
type CartItem=z.infer<typeof cartItemsSchema>[number];
async function priceCart(connection:any,items:CartItem[]){
  const ids=items.map(item=>item.variantId);
  const [variants]=await connection.query(`SELECT v.id,v.sale_price_crc price,v.active,p.active productActive FROM store_variants v JOIN store_products p ON p.id=v.product_id WHERE v.id IN (${ids.map(()=>'?').join(',')})`,ids);
  if(variants.length!==ids.length||variants.some((variant:any)=>!variant.active||!variant.productActive))throw Object.assign(new Error('Una de las variantes ya no está disponible'),{status:409});
  const prices=new Map<number,string>();
  for(const variant of variants)prices.set(Number(variant.id),String(variant.price));
  const subtotalCents=items.reduce((sum,item)=>{
    const price=prices.get(item.variantId);
    if(price===undefined)throw Object.assign(new Error('Una de las variantes ya no está disponible'),{status:409});
    const next=sum+amountToCents(price)*item.quantity;
    if(!Number.isSafeInteger(next))throw Object.assign(new Error('El total del pedido es inválido'),{status:422});
    return next;
  },0);
  return {prices,subtotalCents};
}
async function getPromotionQuote(connection:any,rawCode:string,subtotalCents:number,lock=false,status=422){
  const code=rawCode.trim().toUpperCase();
  const [promotions]=await connection.execute(`SELECT id,code,name,discount_type discountType,discount_value discountValue,
    minimum_subtotal_crc minimumSubtotal,max_redemptions maxRedemptions,active,
    (starts_at<=UTC_TIMESTAMP()) started,(ends_at>UTC_TIMESTAMP()) notExpired
    FROM store_promotions WHERE code=? ${lock?'FOR UPDATE':''}`,[code]);
  const promotion=promotions[0];
  if(!promotion||!promotion.active||!promotion.started||!promotion.notExpired)throw Object.assign(new Error('El código no existe, no está vigente o fue desactivado'),{status});
  let redemptions:number;
  if(lock){
    const [used]=await connection.query(`SELECT r.order_id FROM customer_order_promotions r
      JOIN customer_orders o ON o.id=r.order_id WHERE r.promotion_id=? AND o.status<>'CANCELLED' FOR UPDATE`,[promotion.id]);
    redemptions=used.length;
  }else{
    const [[usage]]=await connection.execute(`SELECT COUNT(*) total FROM customer_order_promotions r
      JOIN customer_orders o ON o.id=r.order_id WHERE r.promotion_id=? AND o.status<>'CANCELLED'`,[promotion.id]);
    redemptions=Number(usage.total);
  }
  if(promotion.maxRedemptions!==null&&redemptions>=Number(promotion.maxRedemptions))throw Object.assign(new Error('La promoción alcanzó su límite de usos'),{status});
  let discountCents:number;
  try{discountCents=promotionDiscountCents({subtotalCents,minimumSubtotal:promotion.minimumSubtotal,type:promotion.discountType,value:promotion.discountValue});}
  catch(error){throw Object.assign(error as Error,{status});}
  return {promotion,subtotalCents,discountCents,totalCents:subtotalCents-discountCents};
}
app.get('/api/health',asyncRoute(async(_req:any,res:any)=>{await pool.query('SELECT 1');res.json({status:'ok',database:'connected',time:new Date().toISOString()});}));
app.post('/api/auth/login',asyncRoute(async(req:any,res:any)=>{const v=z.object({email:z.string().email(),password:z.string().min(8)}).parse(req.body);const [rows]=await pool.execute<any[]>('SELECT u.id,u.nombre,u.email,u.password_hash,u.activo,GROUP_CONCAT(r.codigo) roles FROM usuarios u LEFT JOIN usuario_rol ur ON ur.usuario_id=u.id LEFT JOIN roles r ON r.id=ur.rol_id WHERE u.email=? GROUP BY u.id',[v.email.toLowerCase()]);if(!rows.length||!rows[0].activo||!await bcrypt.compare(v.password,rows[0].password_hash))return res.status(401).json({error:'Correo o contraseña incorrectos'});const token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');await pool.execute('INSERT INTO sesiones(token_hash,usuario_id,expira_en) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? HOUR))',[hash,rows[0].id,env.sessionHours]);res.cookie('dv_session',token,{httpOnly:true,sameSite:'strict',secure:env.nodeEnv==='production',maxAge:env.sessionHours*3600000,path:'/'});res.json({user:{id:rows[0].id,name:rows[0].nombre,email:rows[0].email,roles:String(rows[0].roles||'').split(',').filter(Boolean)}});}));
app.post('/api/auth/logout',requireAuth,asyncRoute(async(req:AuthedRequest,res:any)=>{const token=req.cookies.dv_session;await pool.execute('DELETE FROM sesiones WHERE token_hash=?',[createHash('sha256').update(token).digest('hex')]);res.clearCookie('dv_session',{httpOnly:true,sameSite:'strict',secure:env.nodeEnv==='production',path:'/'});res.status(204).end();}));
app.get('/api/auth/me',requireAuth,asyncRoute(async(req:AuthedRequest,res:any)=>res.json({user:req.user})));
// Public commerce API: browsing and requesting an order never requires the admin session.
app.get('/api/store/products',asyncRoute(async(req:any,res:any)=>{const q=String(req.query.q||'').slice(0,100),size=String(req.query.size||'').slice(0,12),availability=String(req.query.availability||'');const [rows]=await pool.execute<any[]>(`SELECT p.id,p.slug,p.name,p.description,p.product_type productType,p.collection_name collectionName,p.featured,v.id variantId,v.sku,v.size_in size,v.sale_price_crc price,v.low_stock_threshold threshold,COALESCE(SUM(CASE WHEN ms.ubicacion_destino_id=loc.id THEN ms.cantidad ELSE 0 END)-SUM(CASE WHEN ms.ubicacion_origen_id=loc.id THEN ms.cantidad ELSE 0 END),0) stock FROM store_products p JOIN store_variants v ON v.product_id=p.id AND v.active=1 JOIN materiales m ON m.id=v.material_id JOIN ubicaciones loc ON loc.codigo='BOD-CENTRAL' LEFT JOIN movimientos_stock ms ON ms.material_id=m.id WHERE p.active=1 AND (?='' OR p.name LIKE ? OR p.collection_name LIKE ?) AND (?='' OR v.size_in=?) GROUP BY p.id,v.id,loc.id ORDER BY p.featured DESC,p.created_at DESC,p.name`,[q,`%${q}%`,`%${q}%`,size,size]);const filtered=rows.filter((x:any)=>availability!=='available'||Number(x.stock)>0);res.json(filtered.map((x:any)=>({...x,price:Number(x.price),stock:Number(x.stock),tag:`₡${Number(x.price).toLocaleString('es-CR')}`})));}));
app.get('/api/store/products/:slug',asyncRoute(async(req:any,res:any)=>{const [rows]=await pool.execute<any[]>(`SELECT p.id,p.slug,p.name,p.description,p.product_type productType,p.collection_name collectionName,p.featured,v.id variantId,v.sku,v.size_in size,v.sale_price_crc price,v.low_stock_threshold threshold,COALESCE(SUM(CASE WHEN ms.ubicacion_destino_id=loc.id THEN ms.cantidad ELSE 0 END)-SUM(CASE WHEN ms.ubicacion_origen_id=loc.id THEN ms.cantidad ELSE 0 END),0) stock FROM store_products p JOIN store_variants v ON v.product_id=p.id AND v.active=1 JOIN materiales m ON m.id=v.material_id JOIN ubicaciones loc ON loc.codigo='BOD-CENTRAL' LEFT JOIN movimientos_stock ms ON ms.material_id=m.id WHERE p.active=1 AND p.slug=? GROUP BY p.id,v.id,loc.id ORDER BY v.size_in`,[req.params.slug]);if(!rows.length)return res.status(404).json({error:'Producto no encontrado'});res.json({...rows[0],variants:rows.map((x:any)=>({...x,price:Number(x.price),stock:Number(x.stock)}))});}));
app.post('/api/store/orders',rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:true,legacyHeaders:false}),asyncRoute(async(req:any,res:any)=>{
  const v=z.object({customerName:z.string().min(2).max(160),contact:z.string().min(5).max(190),deliveryDetails:z.string().min(5).max(500),notes:z.string().max(500).optional(),items:cartItemsSchema,promotionCode:z.string().trim().min(3).max(30).optional()}).parse(req.body);
  const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    const {prices,subtotalCents}=await priceCart(c,v.items);
    const quote=v.promotionCode?await getPromotionQuote(c,v.promotionCode,subtotalCents,true,409):null;
    const discountCents=quote?.discountCents||0;
    const total=(subtotalCents-discountCents)/100;
    const reference=`SK-${new Date().getFullYear()}-${randomUUID().slice(0,8).toUpperCase()}`;
    const [order]:any=await c.execute('INSERT INTO customer_orders(reference,customer_name,customer_contact,delivery_details,notes,total_crc) VALUES(?,?,?,?,?,?)',[reference,v.customerName,v.contact,v.deliveryDetails,v.notes||null,total]);
    for(const item of v.items)await c.execute('INSERT INTO customer_order_lines(order_id,variant_id,quantity,applied_price_crc) VALUES(?,?,?,?)',[order.insertId,item.variantId,item.quantity,prices.get(item.variantId)]);
    if(quote)await c.execute(`INSERT INTO customer_order_promotions(order_id,promotion_id,promotion_code,discount_type,discount_value,subtotal_crc,discount_crc)
      VALUES(?,?,?,?,?,?,?)`,[order.insertId,quote.promotion.id,quote.promotion.code,quote.promotion.discountType,quote.promotion.discountValue,subtotalCents/100,discountCents/100]);
    const email=z.string().email().safeParse(v.contact.trim());
    let matchedCustomer:any=null,linkMethod:'EMAIL'|'TELEFONO'|null=null;
    if(email.success){
      const [legacy]=await c.execute<any[]>('SELECT id FROM clientes WHERE LOWER(email)=? AND activo=1 LIMIT 1',[email.data.toLowerCase()]);
      if(legacy.length){matchedCustomer=legacy[0];linkMethod='EMAIL';}
      else{
        const [contact]=await c.execute<any[]>('SELECT cliente_id id FROM crm_customer_contacts WHERE tipo=\'EMAIL\' AND valor_normalizado=? LIMIT 1',[email.data.toLowerCase()]);
        if(contact.length){matchedCustomer=contact[0];linkMethod='EMAIL';}
      }
    }else{
      const normalizedPhone=v.contact.replace(/\D/g,'');
      if(normalizedPhone.length>=8&&normalizedPhone.length<=15){
        const [contact]=await c.execute<any[]>('SELECT cliente_id id FROM crm_customer_contacts WHERE tipo=\'TELEFONO\' AND valor_normalizado=? LIMIT 1',[normalizedPhone]);
        if(contact.length){matchedCustomer=contact[0];linkMethod='TELEFONO';}
        else{
          const [legacy]=await c.execute<any[]>(`SELECT id FROM clientes WHERE activo=1 AND REGEXP_REPLACE(COALESCE(telefono,''),'[^0-9]','')=? LIMIT 2`,[normalizedPhone]);
          if(legacy.length===1){matchedCustomer=legacy[0];linkMethod='TELEFONO';}
        }
      }
    }
    if(matchedCustomer&&linkMethod)await c.execute('INSERT INTO crm_customer_order_links(order_id,cliente_id,metodo) VALUES(?,?,?)',[order.insertId,matchedCustomer.id,linkMethod]);
    await c.commit();
    res.status(201).json({reference,subtotal:subtotalCents/100,discount:discountCents/100,total,status:'PENDING',message:'Solicitud recibida. Requiere confirmación del equipo.'});
  }catch(e){await c.rollback();throw e;}finally{c.release();}
}));
app.post('/api/store/promotions/validate',rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:true,legacyHeaders:false}),asyncRoute(async(req:any,res:any)=>{
  const v=z.object({code:z.string().trim().min(3).max(30),items:cartItemsSchema}).parse(req.body);
  const {subtotalCents}=await priceCart(pool,v.items);
  const quote=await getPromotionQuote(pool,v.code,subtotalCents);
  res.json({code:quote.promotion.code,name:quote.promotion.name,subtotal:quote.subtotalCents/100,discount:quote.discountCents/100,total:quote.totalCents/100});
}));

app.use('/api',requireAuth);

app.get('/api/promotions',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(_req:any,res:any)=>{
  const [rows]=await pool.query<any[]>(`SELECT p.id,p.code,p.name,p.discount_type discountType,p.discount_value discountValue,
    p.minimum_subtotal_crc minimumSubtotal,p.starts_at startsAt,p.ends_at endsAt,p.max_redemptions maxRedemptions,p.active,
    (SELECT COUNT(*) FROM customer_order_promotions r JOIN customer_orders o ON o.id=r.order_id
      WHERE r.promotion_id=p.id AND o.status<>'CANCELLED') redemptions
    FROM store_promotions p ORDER BY p.created_at DESC LIMIT 200`);
  res.json(rows);
}));
app.post('/api/promotions',allowRoles('ADMIN'),asyncRoute(async(req:AuthedRequest,res:any)=>{
  const v=z.object({
    code:z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/),
    name:z.string().trim().min(2).max(120),
    discountType:z.enum(['PERCENTAGE','FIXED']),
    discountValue:z.number().positive().refine(value=>Number.isSafeInteger(value*100),'Usa como máximo dos decimales'),
    minimumSubtotal:z.number().min(0).refine(value=>Number.isSafeInteger(value*100),'Usa como máximo dos decimales'),
    startsAt:z.string().datetime(),
    endsAt:z.string().datetime(),
    maxRedemptions:z.number().int().positive().nullable()
  }).superRefine((value,context)=>{
    if(value.discountType==='PERCENTAGE'&&value.discountValue>100)context.addIssue({code:'custom',path:['discountValue'],message:'El porcentaje máximo es 100'});
    if(Date.parse(value.endsAt)<=Date.parse(value.startsAt))context.addIssue({code:'custom',path:['endsAt'],message:'La fecha de fin debe ser posterior al inicio'});
  }).parse(req.body);
  const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    const [result]:any=await c.execute(`INSERT INTO store_promotions(code,name,discount_type,discount_value,minimum_subtotal_crc,starts_at,ends_at,max_redemptions,created_by)
      VALUES(?,?,?,?,?,?,?,?,?)`,[v.code.toUpperCase(),v.name,v.discountType,v.discountValue,v.minimumSubtotal,new Date(v.startsAt).toISOString().slice(0,19).replace('T',' '),new Date(v.endsAt).toISOString().slice(0,19).replace('T',' '),v.maxRedemptions,req.user!.id]);
    await c.execute('INSERT INTO auditoria_eventos(usuario_id,accion,entidad,entidad_id,detalle_json) VALUES(?,\'CREAR\',\'store_promotions\',?,?)',[req.user!.id,String(result.insertId),JSON.stringify({code:v.code.toUpperCase(),discountType:v.discountType})]);
    await c.commit();
    res.status(201).json({id:result.insertId,code:v.code.toUpperCase(),active:true});
  }catch(error:any){
    await c.rollback();
    if(error.code==='ER_DUP_ENTRY')throw Object.assign(new Error('Ya existe una promoción con ese código'),{status:409});
    throw error;
  }finally{c.release();}
}));
app.patch('/api/promotions/:id',allowRoles('ADMIN'),asyncRoute(async(req:AuthedRequest,res:any)=>{
  const id=z.coerce.number().int().positive().parse(req.params.id),v=z.object({active:z.boolean()}).parse(req.body);
  const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    const [[promotion]]=await c.execute<any[]>('SELECT id FROM store_promotions WHERE id=? FOR UPDATE',[id]);
    if(!promotion){await c.rollback();return res.status(404).json({error:'Promoción no encontrada'});}
    const [result]:any=await c.execute('UPDATE store_promotions SET active=? WHERE id=?',[v.active,id]);
    await c.execute('INSERT INTO auditoria_eventos(usuario_id,accion,entidad,entidad_id) VALUES(?,?,?,?)',[req.user!.id,v.active?'ACTIVAR':'DESACTIVAR','store_promotions',String(id)]);
    await c.commit();
    res.json({ok:true,active:v.active});
  }catch(error){await c.rollback();throw error;
  }finally{c.release();}
}));

app.get('/api/store/orders/:id/payments',allowRoles('ADMIN','FINANZAS'),asyncRoute(async(req:any,res:any)=>{
  const id=z.coerce.number().int().positive().parse(req.params.id);
  const [[order]]=await pool.execute<any[]>('SELECT id FROM customer_orders WHERE id=?',[id]);
  if(!order)return res.status(404).json({error:'Pedido no encontrado'});
  const [events]=await pool.execute<any[]>(`SELECT e.id,e.event_type eventType,e.amount_crc amount,e.method,e.reference,
    e.related_payment_id relatedPaymentId,e.occurred_at occurredAt,u.nombre recordedBy
    FROM customer_order_payment_events e JOIN usuarios u ON u.id=e.recorded_by
    WHERE e.order_id=? ORDER BY e.id DESC`,[id]);
  res.json(events);
}));
app.post('/api/store/orders/:id/payments',allowRoles('ADMIN','FINANZAS'),asyncRoute(async(req:AuthedRequest,res:any)=>{
  const orderId=z.coerce.number().int().positive().parse(req.params.id);
  const v=z.object({amount:z.number().positive().refine(value=>Number.isSafeInteger(value*100),'Usa como máximo dos decimales'),method:z.enum(['CASH','TRANSFER','CARD','OTHER']),reference:z.string().trim().min(1).max(120),idempotencyKey:z.string().trim().min(8).max(100)}).parse(req.body);
  const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    const [[order]]=await c.execute<any[]>('SELECT id,status,total_crc FROM customer_orders WHERE id=? FOR UPDATE',[orderId]);
    if(!order)throw Object.assign(new Error('Pedido no encontrado'),{status:404});
    const [existing]=await c.execute<any[]>('SELECT id,order_id,event_type,amount_crc,method,reference FROM customer_order_payment_events WHERE idempotency_key=? FOR UPDATE',[v.idempotencyKey]);
    if(existing.length){
      const event=existing[0];
      if(Number(event.order_id)!==orderId||event.event_type!=='PAYMENT'||Number(event.amount_crc)!==v.amount||event.method!==v.method||event.reference!==v.reference)throw Object.assign(new Error('La clave de idempotencia ya se usó con otros datos'),{status:409});
      await c.commit();
      return res.json({id:event.id,replayed:true});
    }
    if(order.status!=='ACCEPTED')throw Object.assign(new Error('Solo se registran cobros de pedidos aceptados'),{status:409});
    const [events]=await c.execute<any[]>('SELECT event_type,amount_crc FROM customer_order_payment_events WHERE order_id=?',[orderId]);
    if(v.amount*100>outstandingCents(order.total_crc,events))throw Object.assign(new Error('El cobro supera el saldo pendiente del pedido'),{status:409});
    const [result]:any=await c.execute(`INSERT INTO customer_order_payment_events(order_id,event_type,amount_crc,method,reference,idempotency_key,recorded_by)
      VALUES(?,'PAYMENT',?,?,?,?,?)`,[orderId,v.amount,v.method,v.reference,v.idempotencyKey,req.user!.id]);
    await c.execute('INSERT INTO auditoria_eventos(usuario_id,accion,entidad,entidad_id,detalle_json) VALUES(?,\'COBRO_REGISTRADO\',\'customer_order_payment_events\',?,?)',[req.user!.id,String(result.insertId),JSON.stringify({orderId,amount:v.amount,method:v.method})]);
    await c.commit();
    res.status(201).json({id:result.insertId,replayed:false});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}));
app.post('/api/store/orders/:id/refunds',allowRoles('ADMIN','FINANZAS'),asyncRoute(async(req:AuthedRequest,res:any)=>{
  const orderId=z.coerce.number().int().positive().parse(req.params.id);
  const v=z.object({paymentId:z.coerce.number().int().positive(),amount:z.number().positive().refine(value=>Number.isSafeInteger(value*100),'Usa como máximo dos decimales'),method:z.enum(['CASH','TRANSFER','CARD','OTHER']),reference:z.string().trim().min(1).max(120),idempotencyKey:z.string().trim().min(8).max(100)}).parse(req.body);
  const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    const [[order]]=await c.execute<any[]>('SELECT id,status FROM customer_orders WHERE id=? FOR UPDATE',[orderId]);
    if(!order)throw Object.assign(new Error('Pedido no encontrado'),{status:404});
    const [existing]=await c.execute<any[]>('SELECT id,order_id,event_type,amount_crc,method,reference,related_payment_id FROM customer_order_payment_events WHERE idempotency_key=? FOR UPDATE',[v.idempotencyKey]);
    if(existing.length){
      const event=existing[0];
      if(Number(event.order_id)!==orderId||event.event_type!=='REFUND'||Number(event.amount_crc)!==v.amount||event.method!==v.method||event.reference!==v.reference||Number(event.related_payment_id)!==v.paymentId)throw Object.assign(new Error('La clave de idempotencia ya se usó con otros datos'),{status:409});
      await c.commit();
      return res.json({id:event.id,replayed:true});
    }
    const [[payment]]=await c.execute<any[]>('SELECT id,order_id,event_type,amount_crc FROM customer_order_payment_events WHERE id=? FOR UPDATE',[v.paymentId]);
    if(!payment||Number(payment.order_id)!==orderId||payment.event_type!=='PAYMENT')throw Object.assign(new Error('Pago original no encontrado para este pedido'),{status:404});
    if(!['ACCEPTED','CANCELLED'].includes(order.status))throw Object.assign(new Error('Solo se reembolsan pagos de pedidos aceptados o cancelados'),{status:409});
    const [refunds]=await c.execute<any[]>('SELECT event_type,amount_crc FROM customer_order_payment_events WHERE related_payment_id=? AND event_type=\'REFUND\'',[v.paymentId]);
    if(v.amount*100>refundRemainingCents(payment.amount_crc,refunds))throw Object.assign(new Error('El reembolso supera el saldo del pago original'),{status:409});
    const [result]:any=await c.execute(`INSERT INTO customer_order_payment_events(order_id,event_type,amount_crc,method,reference,related_payment_id,idempotency_key,recorded_by)
      VALUES(?,'REFUND',?,?,?,?,?,?)`,[orderId,v.amount,v.method,v.reference,v.paymentId,v.idempotencyKey,req.user!.id]);
    await c.execute('INSERT INTO auditoria_eventos(usuario_id,accion,entidad,entidad_id,detalle_json) VALUES(?,\'REEMBOLSO_REGISTRADO\',\'customer_order_payment_events\',?,?)',[req.user!.id,String(result.insertId),JSON.stringify({orderId,paymentId:v.paymentId,amount:v.amount,method:v.method})]);
    await c.commit();
    res.status(201).json({id:result.insertId,replayed:false});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}));
app.get('/api/crm/customers',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(req:any,res:any)=>{
  const q=String(req.query.q||'').trim().slice(0,100);
  const [rows]=await pool.execute<any[]>(`SELECT c.id,c.codigo,c.nombre,c.email,c.telefono,c.created_at createdAt,
    COALESCE(p.etapa,'NUEVO') etapa,p.notas_admin notasAdmin,p.preferencias_json preferencias,
    COALESCE((SELECT cc.granted FROM crm_customer_consents cc WHERE cc.cliente_id=c.id ORDER BY cc.id DESC LIMIT 1),0) marketingConsent,
    (SELECT COUNT(*) FROM ventas v WHERE v.cliente_id=c.id AND v.estado IN('CONFIRMADA','DEVUELTA')) paidSalesCount,
    (SELECT COUNT(*) FROM crm_customer_order_links l JOIN customer_orders o ON o.id=l.order_id WHERE l.cliente_id=c.id AND o.status='ACCEPTED') acceptedOrdersCount,
    (SELECT COUNT(*) FROM crm_customer_followups f WHERE f.cliente_id=c.id AND f.estado='PENDIENTE') openFollowupsCount
    FROM clientes c LEFT JOIN crm_client_profiles p ON p.cliente_id=c.id
    WHERE c.activo=1 AND (?='' OR c.nombre LIKE ? OR c.email LIKE ? OR c.telefono LIKE ?)
    ORDER BY c.created_at DESC LIMIT 250`,[q,`%${q}%`,`%${q}%`,`%${q}%`]);
  res.json(rows);
}));
app.post('/api/crm/customers',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(req:AuthedRequest,res:any)=>{
  const v=z.object({name:z.string().trim().min(2).max(160),email:z.string().trim().email().max(190).optional(),phone:z.string().trim().min(8).max(40).optional()}).parse(req.body);
  const email=v.email?.toLowerCase()||null,phone=v.phone||null,normalizedPhone=phone?.replace(/\D/g,'')||null;
  if(!email&&!phone)return res.status(422).json({error:'Indica al menos un correo o teléfono'});
  if(normalizedPhone&&(normalizedPhone.length<8||normalizedPhone.length>15))return res.status(422).json({error:'El teléfono debe contener entre 8 y 15 dígitos'});
  const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    if(email){
      const [existing]=await c.execute<any[]>('SELECT id FROM clientes WHERE LOWER(email)=? LIMIT 1 FOR UPDATE',[email]);
      const [contact]=await c.execute<any[]>('SELECT cliente_id id FROM crm_customer_contacts WHERE tipo=\'EMAIL\' AND valor_normalizado=? LIMIT 1 FOR UPDATE',[email]);
      if(existing.length||contact.length)throw Object.assign(new Error('Ya existe un cliente con ese correo'),{status:409});
    }
    if(normalizedPhone){
      const [existing]=await c.execute<any[]>(`SELECT id FROM clientes WHERE REGEXP_REPLACE(COALESCE(telefono,''),'[^0-9]','')=? LIMIT 1 FOR UPDATE`,[normalizedPhone]);
      const [contact]=await c.execute<any[]>('SELECT cliente_id id FROM crm_customer_contacts WHERE tipo=\'TELEFONO\' AND valor_normalizado=? LIMIT 1 FOR UPDATE',[normalizedPhone]);
      if(existing.length||contact.length)throw Object.assign(new Error('Ya existe un cliente con ese teléfono'),{status:409});
    }
    const code=`CRM-${randomUUID().replace(/-/g,'').slice(0,20).toUpperCase()}`;
    const [customer]:any=await c.execute('INSERT INTO clientes(codigo,nombre,email,telefono) VALUES(?,?,?,?)',[code,v.name,email,phone]);
    await c.execute('INSERT INTO crm_client_profiles(cliente_id,etapa) VALUES(? ,\'NUEVO\')',[customer.insertId]);
    if(email)await c.execute('INSERT INTO crm_customer_contacts(cliente_id,tipo,valor,valor_normalizado) VALUES(?,\'EMAIL\',?,?)',[customer.insertId,email,email]);
    if(phone&&normalizedPhone)await c.execute('INSERT INTO crm_customer_contacts(cliente_id,tipo,valor,valor_normalizado) VALUES(?,\'TELEFONO\',?,?)',[customer.insertId,phone,normalizedPhone]);
    await c.execute('INSERT INTO auditoria_eventos(usuario_id,accion,entidad,entidad_id) VALUES(?,\'CREAR\',\'clientes\',?)',[req.user!.id,String(customer.insertId)]);
    await c.commit();
    res.status(201).json({id:customer.insertId,codigo:code,name:v.name,email,phone,stage:'NUEVO',marketingConsent:false});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}));
app.get('/api/crm/customers/:id',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(req:any,res:any)=>{
  const id=z.coerce.number().int().positive().parse(req.params.id);
  const [[customer]]=await pool.execute<any[]>(`SELECT c.id,c.codigo,c.nombre,c.email,c.telefono,c.created_at createdAt,
    COALESCE(p.etapa,'NUEVO') etapa,p.notas_admin notasAdmin,p.preferencias_json preferencias,
    (SELECT cc.granted FROM crm_customer_consents cc WHERE cc.cliente_id=c.id ORDER BY cc.id DESC LIMIT 1) marketingConsent
    FROM clientes c LEFT JOIN crm_client_profiles p ON p.cliente_id=c.id WHERE c.id=? AND c.activo=1`,[id]);
  if(!customer)return res.status(404).json({error:'Cliente no encontrado'});
  const [sales]=await pool.execute<any[]>(`SELECT referencia,estado,subtotal_crc subtotal,descuento_crc descuento,devolucion_crc devolucion,total_neto_crc total,fecha
    FROM ventas WHERE cliente_id=? ORDER BY fecha DESC LIMIT 100`,[id]);
  const [orders]=await pool.execute<any[]>(`SELECT o.id,o.reference,o.status,o.total_crc total,o.created_at createdAt
    FROM crm_customer_order_links l JOIN customer_orders o ON o.id=l.order_id WHERE l.cliente_id=? ORDER BY o.created_at DESC LIMIT 100`,[id]);
  const [followups]=await pool.execute<any[]>(`SELECT f.id,f.tipo,f.estado,f.titulo,f.detalle,f.vence_at dueAt,f.completado_at completedAt,
    a.nombre assignedTo,c.nombre createdBy,f.created_at createdAt
    FROM crm_customer_followups f JOIN usuarios c ON c.id=f.creado_por LEFT JOIN usuarios a ON a.id=f.asignado_a
    WHERE f.cliente_id=? ORDER BY f.created_at DESC LIMIT 100`,[id]);
  const [consents]=await pool.execute<any[]>(`SELECT cc.id,cc.granted,cc.channel,cc.notice_version noticeVersion,cc.created_at createdAt,u.nombre recordedBy
    FROM crm_customer_consents cc LEFT JOIN usuarios u ON u.id=cc.recorded_by WHERE cc.cliente_id=? ORDER BY cc.id DESC LIMIT 50`,[id]);
  res.json({customer,sales,orders,followups,consents});
}));
app.patch('/api/crm/customers/:id',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(req:AuthedRequest,res:any)=>{
  const id=z.coerce.number().int().positive().parse(req.params.id);
  const v=z.object({stage:z.enum(['NUEVO','INTERESADO','CONTACTADO','PEDIDO_SOLICITADO','CLIENTE','RECURRENTE','INACTIVO']).optional(),notes:z.string().max(2000).nullable().optional(),preferences:z.record(z.string(),z.unknown()).nullable().optional()}).parse(req.body);
  const updates:string[]=[];
  if(v.stage!==undefined){updates.push('etapa=VALUES(etapa)');}
  if(v.notes!==undefined){updates.push('notas_admin=VALUES(notas_admin)');}
  if(v.preferences!==undefined){updates.push('preferencias_json=VALUES(preferencias_json)');}
  if(!updates.length)return res.status(422).json({error:'No se recibieron cambios'});
  const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    const [[customer]]=await c.execute<any[]>('SELECT id FROM clientes WHERE id=? AND activo=1 FOR UPDATE',[id]);
    if(!customer)throw Object.assign(new Error('Cliente no encontrado'),{status:404});
    const stage=v.stage||'NUEVO',notes=v.notes??null,preferences=v.preferences==null?null:JSON.stringify(v.preferences);
    await c.execute(`INSERT INTO crm_client_profiles(cliente_id,etapa,notas_admin,preferencias_json) VALUES(?,?,?,?)
      ON DUPLICATE KEY UPDATE ${updates.join(',')}`,[id,stage,notes,preferences]);
    await c.execute('INSERT INTO auditoria_eventos(usuario_id,accion,entidad,entidad_id,detalle_json) VALUES(?,\'ACTUALIZAR\',\'crm_client_profiles\',?,?)',[req.user!.id,String(id),JSON.stringify({stage:v.stage??null,notesChanged:v.notes!==undefined,preferencesChanged:v.preferences!==undefined})]);
    await c.commit();
    res.json({ok:true});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}));
app.post('/api/crm/customers/:id/consents',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(req:AuthedRequest,res:any)=>{
  const id=z.coerce.number().int().positive().parse(req.params.id);
  const v=z.object({granted:z.boolean(),channel:z.enum(['WEB','PRESENCIAL','TELEFONO','OTRO']),noticeVersion:z.string().trim().min(1).max(40)}).parse(req.body);
  const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    const [[customer]]=await c.execute<any[]>('SELECT id FROM clientes WHERE id=? AND activo=1 FOR UPDATE',[id]);
    if(!customer)throw Object.assign(new Error('Cliente no encontrado'),{status:404});
    const [result]:any=await c.execute('INSERT INTO crm_customer_consents(cliente_id,granted,channel,notice_version,recorded_by) VALUES(?,?,?,?,?)',[id,v.granted,v.channel,v.noticeVersion,req.user!.id]);
    await c.execute('INSERT INTO auditoria_eventos(usuario_id,accion,entidad,entidad_id,detalle_json) VALUES(?,?,?,?,?)',[req.user!.id,v.granted?'CONSENTIMIENTO_OTORGADO':'CONSENTIMIENTO_RETIRADO','crm_customer_consents',String(result.insertId),JSON.stringify({customerId:id,channel:v.channel,noticeVersion:v.noticeVersion})]);
    await c.commit();
    res.status(201).json({id:result.insertId,granted:v.granted});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}));
app.post('/api/crm/customers/:id/followups',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(req:AuthedRequest,res:any)=>{
  const id=z.coerce.number().int().positive().parse(req.params.id);
  const v=z.object({type:z.enum(['NOTA','TAREA']),title:z.string().trim().min(2).max(160),detail:z.string().max(1000).optional(),dueAt:z.string().datetime().nullable().optional(),assignedTo:z.coerce.number().int().positive().nullable().optional()}).parse(req.body);
  const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    const [[customer]]=await c.execute<any[]>('SELECT id FROM clientes WHERE id=? AND activo=1 FOR UPDATE',[id]);
    if(!customer)throw Object.assign(new Error('Cliente no encontrado'),{status:404});
    if(v.assignedTo){const [[assignee]]=await c.execute<any[]>('SELECT id FROM usuarios WHERE id=? AND activo=1',[v.assignedTo]);if(!assignee)throw Object.assign(new Error('Responsable no encontrado o inactivo'),{status:422});}
    const [result]:any=await c.execute('INSERT INTO crm_customer_followups(cliente_id,tipo,titulo,detalle,vence_at,asignado_a,creado_por) VALUES(?,?,?,?,?,?,?)',[id,v.type,v.title,v.detail||null,v.dueAt||null,v.assignedTo||null,req.user!.id]);
    await c.execute('INSERT INTO auditoria_eventos(usuario_id,accion,entidad,entidad_id) VALUES(?,\'CREAR\',\'crm_customer_followups\',?)',[req.user!.id,String(result.insertId)]);
    await c.commit();
    res.status(201).json({id:result.insertId,status:'PENDIENTE'});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}));
app.patch('/api/crm/followups/:id',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(req:AuthedRequest,res:any)=>{
  const id=z.coerce.number().int().positive().parse(req.params.id);
  const v=z.object({status:z.enum(['COMPLETADO','CANCELADO'])}).parse(req.body);
  const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    const [[followup]]=await c.execute<any[]>('SELECT id,estado FROM crm_customer_followups WHERE id=? FOR UPDATE',[id]);
    if(!followup)throw Object.assign(new Error('Seguimiento no encontrado'),{status:404});
    if(followup.estado!=='PENDIENTE')throw Object.assign(new Error('El seguimiento ya fue cerrado'),{status:409});
    await c.execute('UPDATE crm_customer_followups SET estado=?,completado_at=UTC_TIMESTAMP() WHERE id=?',[v.status,id]);
    await c.execute('INSERT INTO auditoria_eventos(usuario_id,accion,entidad,entidad_id) VALUES(?,?,?,?)',[req.user!.id,v.status,'crm_customer_followups',String(id)]);
    await c.commit();
    res.json({ok:true,status:v.status});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}));
app.post('/api/crm/customers/:id/orders/:orderId',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(req:AuthedRequest,res:any)=>{
  const customerId=z.coerce.number().int().positive().parse(req.params.id),orderId=z.coerce.number().int().positive().parse(req.params.orderId);
  const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    const [[customer]]=await c.execute<any[]>('SELECT id FROM clientes WHERE id=? AND activo=1 FOR UPDATE',[customerId]);
    if(!customer)throw Object.assign(new Error('Cliente no encontrado'),{status:404});
    const [[order]]=await c.execute<any[]>('SELECT id,customer_contact FROM customer_orders WHERE id=? FOR UPDATE',[orderId]);
    if(!order)throw Object.assign(new Error('Pedido no encontrado'),{status:404});
    const [[linked]]=await c.execute<any[]>('SELECT cliente_id FROM crm_customer_order_links WHERE order_id=? FOR UPDATE',[orderId]);
    if(linked&&Number(linked.cliente_id)!==customerId)throw Object.assign(new Error('El pedido ya está vinculado a otro cliente'),{status:409});
    if(!linked){
      await c.execute('INSERT INTO crm_customer_order_links(order_id,cliente_id,metodo,vinculado_por) VALUES(?,?,\'MANUAL\',?)',[orderId,customerId,req.user!.id]);
      await c.execute('INSERT INTO auditoria_eventos(usuario_id,accion,entidad,entidad_id) VALUES(?,\'VINCULAR\',\'crm_customer_order_links\',?)',[req.user!.id,String(orderId)]);
    }
    await c.commit();
    res.json({ok:true,customerId,orderId,replayed:Boolean(linked)});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}));

app.get('/api/store/orders',allowRoles('ADMIN','COMPRAS','BODEGA','FINANZAS'),asyncRoute(async(_req:any,res:any)=>{
  const [rows]=await pool.query<any[]>(`SELECT o.id,o.reference,o.status,o.customer_name customerName,o.customer_contact contact,
    o.delivery_details deliveryDetails,o.total_crc total,o.created_at createdAt,op.promotion_code promotionCode,
    op.subtotal_crc originalSubtotal,op.discount_crc discount,l.cliente_id customerId,c.nombre crmCustomerName,COALESCE(p.collected_crc,0) collected
    FROM customer_orders o
    LEFT JOIN crm_customer_order_links l ON l.order_id=o.id
    LEFT JOIN clientes c ON c.id=l.cliente_id
    LEFT JOIN customer_order_promotions op ON op.order_id=o.id
    LEFT JOIN (SELECT order_id,SUM(CASE WHEN event_type='PAYMENT' THEN amount_crc ELSE -amount_crc END) collected_crc
      FROM customer_order_payment_events GROUP BY order_id) p ON p.order_id=o.id
    ORDER BY o.created_at DESC LIMIT 100`);
  res.json(rows);
}));
app.post('/api/store/orders/:id/accept',allowRoles('ADMIN','BODEGA'),asyncRoute(async(req:AuthedRequest,res:any)=>{const c=await pool.getConnection();try{await c.beginTransaction();const [orders]=await c.execute<any[]>('SELECT * FROM customer_orders WHERE id=? FOR UPDATE',[req.params.id]);if(!orders.length)throw Object.assign(new Error('Pedido no encontrado'),{status:404});if(orders[0].status!=='PENDING')throw Object.assign(new Error('El pedido ya fue procesado'),{status:409});const [lines]=await c.execute<any[]>('SELECT l.*,v.material_id FROM customer_order_lines l JOIN store_variants v ON v.id=l.variant_id WHERE l.order_id=? ORDER BY v.material_id FOR UPDATE',[req.params.id]);const [locs]=await c.execute<any[]>('SELECT id FROM ubicaciones WHERE codigo=\'BOD-CENTRAL\' LIMIT 1');const locationId=Number(locs[0].id);for(const line of lines){await c.execute('INSERT IGNORE INTO stock_locks(material_id,ubicacion_id) VALUES(?,?)',[line.material_id,locationId]);await c.execute('SELECT material_id FROM stock_locks WHERE material_id=? AND ubicacion_id=? FOR UPDATE',[line.material_id,locationId]);const [balanceRows]=await c.execute<any[]>('SELECT COALESCE(SUM(CASE WHEN ubicacion_destino_id=? THEN cantidad ELSE 0 END)-SUM(CASE WHEN ubicacion_origen_id=? THEN cantidad ELSE 0 END),0) stock FROM movimientos_stock WHERE material_id=?',[locationId,locationId,line.material_id]);if(Number(balanceRows[0].stock)<Number(line.quantity))throw Object.assign(new Error(`Stock insuficiente para la línea ${line.id}`),{status:409});await c.execute('INSERT INTO movimientos_stock(material_id,cantidad,tipo,ubicacion_origen_id,usuario_id,documento,motivo,idempotency_key) VALUES(?,?,\'SALIDA\',?,?,?, ?,?)',[line.material_id,line.quantity,locationId,req.user!.id,orders[0].reference,'Pedido de cliente aceptado',`customer-order-${req.params.id}-${line.id}`]);}await c.execute("UPDATE customer_orders SET status='ACCEPTED',accepted_at=UTC_TIMESTAMP() WHERE id=?",[req.params.id]);await c.commit();res.json({ok:true,status:'ACCEPTED'});}catch(e){await c.rollback();throw e;}finally{c.release();}}));
app.post('/api/store/orders/:id/cancel',allowRoles('ADMIN','BODEGA'),asyncRoute(async(req:AuthedRequest,res:any)=>{
  const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    const [orders]=await c.execute<any[]>('SELECT * FROM customer_orders WHERE id=? FOR UPDATE',[req.params.id]);
    if(!orders.length)throw Object.assign(new Error('Pedido no encontrado'),{status:404});
    if(orders[0].status==='CANCELLED'){await c.commit();return res.json({ok:true,status:'CANCELLED',replayed:true});}
    const [payments]=await c.execute<any[]>('SELECT event_type,amount_crc FROM customer_order_payment_events WHERE order_id=?',[req.params.id]);
    if(collectedCents(payments)>0)throw Object.assign(new Error('Registra el reembolso total antes de cancelar un pedido con pagos'),{status:409});
    const [lines]=await c.execute<any[]>('SELECT l.*,v.material_id FROM customer_order_lines l JOIN store_variants v ON v.id=l.variant_id WHERE l.order_id=? ORDER BY v.material_id FOR UPDATE',[req.params.id]);
    const [locs]=await c.execute<any[]>('SELECT id FROM ubicaciones WHERE codigo=\'BOD-CENTRAL\' LIMIT 1');
    for(const line of lines)await c.execute('INSERT INTO movimientos_stock(material_id,cantidad,tipo,ubicacion_destino_id,usuario_id,documento,motivo,idempotency_key) VALUES(?,?,\'AJUSTE_POSITIVO\',?,?,?, ?,?)',[line.material_id,line.quantity,locs[0].id,req.user!.id,orders[0].reference,'Reposición por cancelación de pedido',`customer-order-cancel-${req.params.id}-${line.id}`]);
    await c.execute("UPDATE customer_orders SET status='CANCELLED',cancelled_at=UTC_TIMESTAMP() WHERE id=?",[req.params.id]);
    await c.commit();
    res.json({ok:true,status:'CANCELLED'});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}));
app.get('/api/dashboard/resumen',asyncRoute(async(_req:any,res:any)=>{const [inventory]=await pool.execute<any[]>(`SELECT m.id,m.sku,m.nombre,m.unidad,u.id ubicacion_id,u.nombre ubicacion,COALESCE(SUM(CASE WHEN ms.ubicacion_destino_id=u.id THEN ms.cantidad ELSE 0 END)-SUM(CASE WHEN ms.ubicacion_origen_id=u.id THEN ms.cantidad ELSE 0 END),0) stock,ps.demanda_prom,ps.demanda_max,ps.lead_time_dias FROM politicas_stock ps JOIN materiales m ON m.id=ps.material_id JOIN ubicaciones u ON u.id=ps.ubicacion_id LEFT JOIN movimientos_stock ms ON ms.material_id=m.id GROUP BY m.id,u.id,ps.id`);const rows=inventory.map((r:any)=>{const ss=(r.demanda_max-r.demanda_prom)*r.lead_time_dias,pr=r.demanda_prom*r.lead_time_dias+ss;return {...r,ss,pr,alerta:r.stock<=pr};});const [moves]=await pool.execute<any[]>(`SELECT ms.id,ms.tipo,ms.cantidad,ms.created_at,m.nombre material,u.nombre ubicacion,ms.documento FROM movimientos_stock ms JOIN materiales m ON m.id=ms.material_id LEFT JOIN ubicaciones u ON u.id=COALESCE(ms.ubicacion_destino_id,ms.ubicacion_origen_id) ORDER BY ms.created_at DESC LIMIT 8`);const [ocs]=await pool.execute<any[]>(`SELECT COUNT(*) total,COALESCE(SUM(ocd.cantidad*ocd.precio_unitario_historico),0) gasto FROM ordenes_compra oc JOIN orden_compra_detalle ocd ON ocd.orden_id=oc.id`);const alerts=rows.filter((r:any)=>r.alerta);res.json({kpis:{materiales:await scalar('SELECT COUNT(*) n FROM materiales WHERE activo=1'),proveedores:await scalar('SELECT COUNT(*) n FROM proveedores WHERE activo=1'),alertas:alerts.length,gastoCRC:Number(ocs[0].gasto)},inventory:rows,movements:moves,alerts});}));
async function scalar(sql:string){const [r]=await pool.query<any[]>(sql);return Number(r[0].n)}
app.get('/api/materiales',asyncRoute(async(req:any,res:any)=>{const q=String(req.query.q||'').slice(0,100),[rows]=await pool.execute<any[]>(`SELECT m.*,c.nombre categoria FROM materiales m JOIN categorias c ON c.id=m.categoria_id WHERE (?='' OR m.sku LIKE ? OR m.nombre LIKE ?) ORDER BY m.nombre LIMIT 250`,[q,`%${q}%`,`%${q}%`]);res.json(rows);}));
app.post('/api/materiales',allowRoles('ADMIN','COMPRAS','BODEGA'),asyncRoute(async(req:AuthedRequest,res:any)=>{const v=z.object({sku:z.string().min(2).max(48),nombre:z.string().min(2).max(160),descripcion:z.string().max(2000).optional(),especificacion:z.string().max(255).default(''),unidad:z.string().min(1).max(24),categoria_id:z.coerce.number().int().positive()}).parse(req.body);const [r]=await pool.execute<any>('INSERT INTO materiales(sku,nombre,descripcion,especificacion,unidad,categoria_id) VALUES(?,?,?,?,?,?)',[v.sku,v.nombre,v.descripcion||null,v.especificacion,v.unidad,v.categoria_id]);await audit(req.user!.id,'CREAR','materiales',String(r.insertId));res.status(201).json({id:r.insertId,...v});}));
app.patch('/api/materiales/:id',allowRoles('ADMIN','COMPRAS','BODEGA'),asyncRoute(async(req:AuthedRequest,res:any)=>{const v=z.object({nombre:z.string().min(2).max(160).optional(),descripcion:z.string().max(2000).nullable().optional(),especificacion:z.string().max(255).optional(),unidad:z.string().max(24).optional(),activo:z.boolean().optional()}).parse(req.body);const fields=Object.entries(v);if(!fields.length)return res.status(400).json({error:'No hay cambios'});await pool.execute(`UPDATE materiales SET ${fields.map(([k])=>`${k}=?`).join(',')} WHERE id=?`,[...fields.map(([,x])=>x),String(req.params.id)]);res.json({ok:true});}));
app.get('/api/proveedor-material',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query<any[]>(`SELECT pm.*,p.nombre proveedor,m.nombre material,m.sku,pp.precio_crc,pp.vigente_desde FROM proveedor_material pm JOIN proveedores p ON p.id=pm.proveedor_id JOIN materiales m ON m.id=pm.material_id LEFT JOIN precios_proveedor pp ON pp.material_id=pm.material_id AND pp.proveedor_id=pm.proveedor_id AND pp.vigente_hasta IS NULL ORDER BY m.nombre,p.nombre`);res.json(r);}));
app.post('/api/proveedor-material',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(req:any,res:any)=>{const v=z.object({material_id:z.coerce.number().positive(),proveedor_id:z.coerce.number().positive(),sku_externo:z.string().max(80).optional(),plazo_dias:z.coerce.number().int().min(0),precio_crc:z.coerce.number().min(0).optional(),vigente_desde:z.string().date().optional()}).parse(req.body);const c=await pool.getConnection();try{await c.beginTransaction();await c.execute('INSERT INTO proveedor_material(material_id,proveedor_id,sku_externo,plazo_dias) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE sku_externo=VALUES(sku_externo),plazo_dias=VALUES(plazo_dias),activo=1',[v.material_id,v.proveedor_id,v.sku_externo||null,v.plazo_dias]);if(v.precio_crc!==undefined)await c.execute('INSERT INTO precios_proveedor(material_id,proveedor_id,precio_crc,vigente_desde,fuente) VALUES(?,?,?,?,?)',[v.material_id,v.proveedor_id,v.precio_crc,v.vigente_desde||new Date().toISOString().slice(0,10),'Precio registrado manualmente']);await c.commit();res.status(201).json({ok:true});}catch(e){await c.rollback();throw e;}finally{c.release();}}));
app.get('/api/proveedores',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query('SELECT * FROM proveedores ORDER BY nombre');res.json(r);}));
app.post('/api/proveedores',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(req:AuthedRequest,res:any)=>{const v=z.object({codigo:z.string().min(1).max(32),nombre:z.string().min(2).max(150),contacto:z.string().max(120).optional(),email:z.string().email().optional().or(z.literal('')),telefono:z.string().max(40).optional(),condiciones_pago:z.string().max(160).optional()}).parse(req.body);const [r]=await pool.execute<any>('INSERT INTO proveedores(codigo,nombre,contacto,email,telefono,condiciones_pago) VALUES(?,?,?,?,?,?)',[v.codigo,v.nombre,v.contacto||null,v.email||null,v.telefono||null,v.condiciones_pago||null]);await audit(req.user!.id,'CREAR','proveedores',String(r.insertId));res.status(201).json({id:r.insertId,...v});}));
app.post('/api/categorias',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(req:any,res:any)=>{const v=z.object({nombre:z.string().min(2).max(90)}).parse(req.body);const [r]:any=await pool.execute('INSERT INTO categorias(nombre) VALUES(?)',[v.nombre]);res.status(201).json({id:r.insertId,...v});}));
app.patch('/api/categorias/:id',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(req:any,res:any)=>{const v=z.object({nombre:z.string().min(2).max(90).optional(),activo:z.boolean().optional()}).parse(req.body);const entries=Object.entries(v);if(!entries.length)return res.status(400).json({error:'No hay cambios'});await pool.execute(`UPDATE categorias SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`,[...entries.map(([,v])=>v),String(req.params.id)]);res.json({ok:true});}));
app.get('/api/materiales/:id/alias',asyncRoute(async(req:any,res:any)=>{const [r]=await pool.execute('SELECT * FROM material_alias WHERE material_id=? ORDER BY alias',[String(req.params.id)]);res.json(r);}));
app.post('/api/materiales/:id/alias',allowRoles('ADMIN','COMPRAS','BODEGA'),asyncRoute(async(req:any,res:any)=>{const v=z.object({alias:z.string().min(2).max(160),origen:z.string().max(80).optional()}).parse(req.body);const [r]:any=await pool.execute('INSERT INTO material_alias(material_id,alias,origen) VALUES(?,?,?)',[String(req.params.id),v.alias,v.origen||null]);res.status(201).json({id:r.insertId,...v});}));
app.patch('/api/proveedores/:id',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(req:any,res:any)=>{const v=z.object({nombre:z.string().min(2).max(150).optional(),contacto:z.string().max(120).nullable().optional(),email:z.string().email().nullable().optional(),telefono:z.string().max(40).nullable().optional(),condiciones_pago:z.string().max(160).nullable().optional(),activo:z.boolean().optional()}).parse(req.body);const e=Object.entries(v);if(!e.length)return res.status(400).json({error:'No hay cambios'});await pool.execute(`UPDATE proveedores SET ${e.map(([k])=>`${k}=?`).join(',')} WHERE id=?`,[...e.map(([,v])=>v),String(req.params.id)]);res.json({ok:true});}));
app.post('/api/ubicaciones',allowRoles('ADMIN','BODEGA'),asyncRoute(async(req:any,res:any)=>{const v=z.object({codigo:z.string().min(2).max(40),nombre:z.string().min(2).max(120),tipo:z.enum(['BODEGA','OBRA']),area_id:z.coerce.number().positive().nullable().optional()}).parse(req.body);const [r]:any=await pool.execute('INSERT INTO ubicaciones(codigo,nombre,tipo,area_id) VALUES(?,?,?,?)',[v.codigo,v.nombre,v.tipo,v.area_id||null]);res.status(201).json({id:r.insertId,...v});}));
app.patch('/api/ubicaciones/:id',allowRoles('ADMIN','BODEGA'),asyncRoute(async(req:any,res:any)=>{const v=z.object({nombre:z.string().min(2).max(120).optional(),activo:z.boolean().optional()}).parse(req.body);const e=Object.entries(v);if(!e.length)return res.status(400).json({error:'No hay cambios'});await pool.execute(`UPDATE ubicaciones SET ${e.map(([k])=>`${k}=?`).join(',')} WHERE id=?`,[...e.map(([,v])=>v),String(req.params.id)]);res.json({ok:true});}));
app.get('/api/categorias',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query('SELECT * FROM categorias WHERE activo=1 ORDER BY nombre');res.json(r);}));
app.get('/api/areas',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query('SELECT * FROM areas ORDER BY nombre');res.json(r);}));
app.get('/api/usuarios',requireAuth,allowRoles('ADMIN'),asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query<any[]>(`SELECT u.id,u.nombre,u.email,u.activo,GROUP_CONCAT(ro.codigo) roles FROM usuarios u JOIN usuario_rol ur ON ur.usuario_id=u.id JOIN roles ro ON ro.id=ur.rol_id GROUP BY u.id ORDER BY u.nombre`);res.json(r);}));
app.post('/api/usuarios',allowRoles('ADMIN'),asyncRoute(async(req:AuthedRequest,res:any)=>{const v=z.object({nombre:z.string().min(2).max(120),email:z.string().email(),password:z.string().min(12).max(128),roles:z.array(z.enum(['ADMIN','COMPRAS','BODEGA','FINANZAS','LECTOR'])).min(1)}).parse(req.body);const c=await pool.getConnection();try{await c.beginTransaction();const hash=await bcrypt.hash(v.password,12);const [u]:any=await c.execute('INSERT INTO usuarios(nombre,email,password_hash) VALUES(?,?,?)',[v.nombre,v.email.toLowerCase(),hash]);for(const role of v.roles)await c.execute('INSERT INTO usuario_rol(usuario_id,rol_id) SELECT ?,id FROM roles WHERE codigo=?',[u.insertId,role]);await c.commit();res.status(201).json({id:u.insertId,nombre:v.nombre,email:v.email,roles:v.roles});}catch(e){await c.rollback();throw e;}finally{c.release();}}));
app.get('/api/ubicaciones',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query('SELECT * FROM ubicaciones ORDER BY nombre');res.json(r);}));
app.get('/api/politicas-stock',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query<any[]>(`SELECT ps.*,m.nombre material,m.sku,m.unidad,u.nombre ubicacion,u.codigo FROM politicas_stock ps JOIN materiales m ON m.id=ps.material_id JOIN ubicaciones u ON u.id=ps.ubicacion_id ORDER BY m.nombre`);const out=[];for(const x of r){const [s]=await pool.execute<any[]>(`SELECT COALESCE(SUM(CASE WHEN ubicacion_destino_id=? THEN cantidad ELSE 0 END)-SUM(CASE WHEN ubicacion_origen_id=? THEN cantidad ELSE 0 END),0) stock FROM movimientos_stock WHERE material_id=?`,[x.ubicacion_id,x.ubicacion_id,x.material_id]);const ss=(x.demanda_max-x.demanda_prom)*x.lead_time_dias,pr=x.demanda_prom*x.lead_time_dias+ss;out.push({...x,stock:s[0].stock,ss,pr,coberturaDias:x.demanda_prom?Number(s[0].stock)/x.demanda_prom:null});}res.json(out);}));
app.put('/api/politicas-stock/:materialId/:ubicacionId',allowRoles('ADMIN','COMPRAS','BODEGA'),asyncRoute(async(_req:any,res:any)=>{const v=z.object({stock_min:z.coerce.number().min(0),stock_max:z.coerce.number().min(0).nullable(),demanda_prom:z.coerce.number().min(0),demanda_max:z.coerce.number().min(0),lead_time_dias:z.coerce.number().min(0)}).refine(x=>x.demanda_max>=x.demanda_prom).parse(_req.body);await pool.execute('INSERT INTO politicas_stock(material_id,ubicacion_id,stock_min,stock_max,demanda_prom,demanda_max,lead_time_dias) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE stock_min=VALUES(stock_min),stock_max=VALUES(stock_max),demanda_prom=VALUES(demanda_prom),demanda_max=VALUES(demanda_max),lead_time_dias=VALUES(lead_time_dias)',[_req.params.materialId,_req.params.ubicacionId,v.stock_min,v.stock_max,v.demanda_prom,v.demanda_max,v.lead_time_dias]);res.json({ok:true});}));
app.post('/api/movimientos',allowRoles('ADMIN','BODEGA'),asyncRoute(async(req:AuthedRequest,res:any)=>{const v=z.object({materialId:z.coerce.number().int().positive(),quantity:z.coerce.number().positive(),type:z.enum(['ENTRADA','SALIDA','TRASLADO','AJUSTE_POSITIVO','AJUSTE_NEGATIVO']),fromId:z.coerce.number().int().positive().optional(),toId:z.coerce.number().int().positive().optional(),document:z.string().max(160).optional(),reason:z.string().max(500).optional(),idempotencyKey:z.string().min(8).max(100)}).parse(req.body);if(['SALIDA','AJUSTE_NEGATIVO'].includes(v.type)&&(!v.fromId||v.toId))return res.status(422).json({error:'Salida requiere solo ubicación de origen'});if(['ENTRADA','AJUSTE_POSITIVO'].includes(v.type)&&(!v.toId||v.fromId))return res.status(422).json({error:'Entrada requiere solo ubicación de destino'});if(v.type==='TRASLADO'&&(!v.fromId||!v.toId))return res.status(422).json({error:'Traslado requiere origen y destino'});const result=await createMovement({...v,key:v.idempotencyKey,userId:req.user!.id});await audit(req.user!.id,'MOVIMIENTO','movimientos_stock',String(result.id));res.status(result.replayed?200:201).json(result);}));
app.get('/api/movimientos',asyncRoute(async(req:any,res:any)=>{const [r]=await pool.execute<any[]>(`SELECT ms.*,m.sku,m.nombre material,uo.nombre origen,ud.nombre destino,u.nombre usuario FROM movimientos_stock ms JOIN materiales m ON m.id=ms.material_id LEFT JOIN ubicaciones uo ON uo.id=ms.ubicacion_origen_id LEFT JOIN ubicaciones ud ON ud.id=ms.ubicacion_destino_id LEFT JOIN usuarios u ON u.id=ms.usuario_id ORDER BY ms.created_at DESC LIMIT 250`);res.json(r);}));
app.get('/api/materiales/:id/trazabilidad',asyncRoute(async(req:any,res:any)=>{const [r]=await pool.execute<any[]>(`SELECT ms.*,rd.cantidad recibida,rc.numero recepcion,rc.documento documento_recepcion,oc.numero orden_compra,od.precio_unitario_historico FROM movimientos_stock ms LEFT JOIN recepcion_detalle rd ON rd.id=ms.recepcion_detalle_id LEFT JOIN recepciones rc ON rc.id=rd.recepcion_id LEFT JOIN orden_compra_detalle od ON od.id=rd.orden_detalle_id LEFT JOIN ordenes_compra oc ON oc.id=od.orden_id WHERE ms.material_id=? ORDER BY ms.created_at DESC`,[req.params.id]);res.json(r);}));
app.get('/api/alertas/reorden',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query<any[]>(`SELECT a.*,m.nombre material,m.sku,u.nombre ubicacion FROM alertas a JOIN materiales m ON m.id=a.material_id JOIN ubicaciones u ON u.id=a.ubicacion_id ORDER BY a.created_at DESC`);res.json(r);}));
app.get('/api/requisiciones',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query<any[]>(`SELECT rq.*,a.nombre area,u.nombre solicitante,COUNT(rd.id) lineas FROM requisiciones rq JOIN areas a ON a.id=rq.area_id JOIN usuarios u ON u.id=rq.solicitante_id LEFT JOIN requisicion_detalle rd ON rd.requisicion_id=rq.id GROUP BY rq.id ORDER BY rq.created_at DESC`);res.json(r);}));
app.post('/api/requisiciones',allowRoles('ADMIN','COMPRAS','BODEGA'),asyncRoute(async(req:AuthedRequest,res:any)=>{const v=z.object({numero:z.string().min(3).max(48),areaId:z.coerce.number().positive(),motivo:z.string().max(500).optional(),items:z.array(z.object({materialId:z.coerce.number().positive(),cantidad:z.coerce.number().positive()})).min(1)}).parse(req.body);const c=await pool.getConnection();try{await c.beginTransaction();const [rq]:any=await c.execute("INSERT INTO requisiciones(numero,area_id,solicitante_id,estado,motivo) VALUES(?,?,?,'PENDIENTE',?)",[v.numero,v.areaId,req.user!.id,v.motivo||null]);for(const item of v.items)await c.execute('INSERT INTO requisicion_detalle(requisicion_id,material_id,cantidad) VALUES(?,?,?)',[rq.insertId,item.materialId,item.cantidad]);await c.commit();res.status(201).json({id:rq.insertId,numero:v.numero,estado:'PENDIENTE'});}catch(e){await c.rollback();throw e;}finally{c.release();}}));
app.post('/api/requisiciones/:id/decision',allowRoles('ADMIN','COMPRAS','FINANZAS'),asyncRoute(async(req:AuthedRequest,res:any)=>{const v=z.object({decision:z.enum(['APROBADA','RECHAZADA']),comentario:z.string().max(500).optional()}).parse(req.body);const c=await pool.getConnection();try{await c.beginTransaction();const [rows]=await c.execute<any[]>('SELECT * FROM requisiciones WHERE id=? FOR UPDATE',[String(req.params.id)]);if(!rows.length)throw Object.assign(new Error('Requisición no encontrada'),{status:404});if(rows[0].estado!=='PENDIENTE')throw Object.assign(new Error('La requisición ya fue procesada'),{status:409});if(rows[0].solicitante_id===req.user!.id)throw Object.assign(new Error('No se permite aprobar la propia requisición'),{status:409});await c.execute('UPDATE requisiciones SET estado=? WHERE id=?',[v.decision,String(req.params.id)]);await c.execute('INSERT INTO requisicion_aprobaciones(requisicion_id,usuario_id,decision,comentario) VALUES(?,?,?,?)',[String(req.params.id),req.user!.id,v.decision,v.comentario||null]);await c.commit();res.json({ok:true});}catch(e){await c.rollback();throw e;}finally{c.release();}}));
app.post('/api/cotizaciones',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(req:any,res:any)=>{const v=z.object({numero:z.string().min(3).max(48),requisicionId:z.coerce.number().positive(),proveedorId:z.coerce.number().positive(),fecha:z.string().date(),documento:z.string().max(160).optional(),condiciones:z.string().max(255).optional(),items:z.array(z.object({materialId:z.coerce.number().positive(),cantidad:z.coerce.number().positive(),precioCRC:z.coerce.number().min(0)})).min(1)}).parse(req.body);const c=await pool.getConnection();try{await c.beginTransaction();const [q]:any=await c.execute('INSERT INTO cotizaciones(numero,requisicion_id,proveedor_id,fecha,documento,condiciones) VALUES(?,?,?,?,?,?)',[v.numero,v.requisicionId,v.proveedorId,v.fecha,v.documento||null,v.condiciones||null]);for(const i of v.items)await c.execute('INSERT INTO cotizacion_detalle(cotizacion_id,material_id,cantidad,precio_unitario_crc) VALUES(?,?,?,?)',[q.insertId,i.materialId,i.cantidad,i.precioCRC]);await c.commit();res.status(201).json({id:q.insertId});}catch(e){await c.rollback();throw e;}finally{c.release();}}));
app.get('/api/criterios-evaluacion',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query('SELECT * FROM criterios_evaluacion WHERE activo=1 ORDER BY id');res.json(r);}));
app.post('/api/proveedores/:id/evaluaciones',allowRoles('ADMIN','COMPRAS','FINANZAS'),asyncRoute(async(req:AuthedRequest,res:any)=>{const v=z.object({comentario:z.string().max(500).optional(),puntajes:z.array(z.object({criterioId:z.coerce.number().positive(),puntaje:z.coerce.number().int().min(1).max(5)})).min(1)}).parse(req.body);const [criteria]=await pool.query<any[]>('SELECT id,peso FROM criterios_evaluacion WHERE activo=1');const weight=criteria.reduce((s:number,x:any)=>s+Number(x.peso),0);if(Math.abs(weight-100)>0.001)return res.status(409).json({error:'Los pesos activos deben sumar 100%'});if(v.puntajes.length!==criteria.length||new Set(v.puntajes.map(x=>x.criterioId)).size!==criteria.length||v.puntajes.some(x=>!criteria.find((c:any)=>c.id===x.criterioId)))return res.status(422).json({error:'Se requiere un puntaje por cada criterio activo'});const score=v.puntajes.reduce((s,x)=>s+Number(criteria.find((c:any)=>c.id===x.criterioId).peso)*x.puntaje,0)/100;const c=await pool.getConnection();try{await c.beginTransaction();const [ev]:any=await c.execute('INSERT INTO evaluaciones_proveedor(proveedor_id,usuario_id,fecha,comentario,puntaje_ponderado) VALUES(?,?,UTC_DATE(),?,?)',[String(req.params.id),req.user!.id,v.comentario||null,score]);for(const x of v.puntajes)await c.execute('INSERT INTO evaluacion_detalle(evaluacion_id,criterio_id,puntaje) VALUES(?,?,?)',[ev.insertId,x.criterioId,x.puntaje]);await c.commit();res.status(201).json({id:ev.insertId,puntaje_ponderado:score});}catch(e){await c.rollback();throw e;}finally{c.release();}}));
app.get('/api/proveedores/:id/evaluaciones',asyncRoute(async(req:any,res:any)=>{const [r]=await pool.execute<any[]>(`SELECT e.id,e.fecha,e.comentario,e.puntaje_ponderado,u.nombre evaluador,cd.criterio_id,ce.nombre criterio,ce.peso,cd.puntaje FROM evaluaciones_proveedor e JOIN usuarios u ON u.id=e.usuario_id JOIN evaluacion_detalle cd ON cd.evaluacion_id=e.id JOIN criterios_evaluacion ce ON ce.id=cd.criterio_id WHERE e.proveedor_id=? ORDER BY e.fecha DESC,ce.id`,[String(req.params.id)]);res.json(r);}));
app.post('/api/facturas',allowRoles('ADMIN','FINANZAS'),asyncRoute(async(req:any,res:any)=>{const v=z.object({numero:z.string().min(2).max(80),ordenId:z.coerce.number().positive(),fecha:z.string().date(),montoCRC:z.coerce.number().positive()}).parse(req.body);const c=await pool.getConnection();try{await c.beginTransaction();const [orders]=await c.execute<any[]>("SELECT estado FROM ordenes_compra WHERE id=? FOR UPDATE",[v.ordenId]);if(!orders.length)throw Object.assign(new Error('Orden no encontrada'),{status:404});if(orders[0].estado!=='RECIBIDA')throw Object.assign(new Error('El three-way match requiere una recepción completa'),{status:409});const [total]=await c.execute<any[]>(`SELECT SUM(cantidad*precio_unitario_historico) total FROM orden_compra_detalle WHERE orden_id=?`,[v.ordenId]);if(v.montoCRC>Number(total[0].total))throw Object.assign(new Error('El monto de factura excede el total de la OC'),{status:409});const [f]:any=await c.execute("INSERT INTO facturas(numero,orden_id,fecha,monto_crc,estado) VALUES(?,?,?,?,'REGISTRADA')",[v.numero,v.ordenId,v.fecha,v.montoCRC]);await c.commit();res.status(201).json({id:f.insertId});}catch(e){await c.rollback();throw e;}finally{c.release();}}));
app.post('/api/pagos-registrados',allowRoles('ADMIN','FINANZAS'),asyncRoute(async(req:any,res:any)=>{const v=z.object({facturaId:z.coerce.number().positive(),fecha:z.string().date(),montoCRC:z.coerce.number().positive(),referencia:z.string().max(120).optional()}).parse(req.body);const c=await pool.getConnection();try{await c.beginTransaction();const [f]=await c.execute<any[]>('SELECT monto_crc FROM facturas WHERE id=? FOR UPDATE',[v.facturaId]);if(!f.length)throw Object.assign(new Error('Factura no encontrada'),{status:404});const [paid]=await c.execute<any[]>(`SELECT COALESCE(SUM(monto_crc),0) total FROM pagos_registrados WHERE factura_id=?`,[v.facturaId]);if(Number(paid[0].total)+v.montoCRC>Number(f[0].monto_crc))throw Object.assign(new Error('El pago excede el saldo pendiente de la factura'),{status:409});const [p]:any=await c.execute('INSERT INTO pagos_registrados(factura_id,fecha,monto_crc,referencia) VALUES(?,?,?,?)',[v.facturaId,v.fecha,v.montoCRC,v.referencia||null]);await c.commit();res.status(201).json({id:p.insertId});}catch(e){await c.rollback();throw e;}finally{c.release();}}));
app.post('/api/ordenes',allowRoles('ADMIN','COMPRAS'),asyncRoute(async(req:AuthedRequest,res:any)=>{const v=z.object({numero:z.string().min(3).max(48),proveedorId:z.coerce.number().positive(),areaId:z.coerce.number().positive(),fecha:z.string().date(),notas:z.string().max(500).optional(),requisicionId:z.coerce.number().positive().optional(),items:z.array(z.object({materialId:z.coerce.number().positive(),cantidad:z.coerce.number().positive(),precioCRC:z.coerce.number().min(0)})).min(1)}).parse(req.body);const c=await pool.getConnection();try{await c.beginTransaction();const [o]:any=await c.execute("INSERT INTO ordenes_compra(numero,proveedor_id,area_id,fecha,estado,comprador_id,notas,requisicion_id) VALUES(?,?,?,?,'PENDIENTE',?,?,?)",[v.numero,v.proveedorId,v.areaId,v.fecha,req.user!.id,v.notas||null,v.requisicionId||null]);for(const item of v.items)await c.execute('INSERT INTO orden_compra_detalle(orden_id,material_id,cantidad,precio_unitario_historico) VALUES(?,?,?,?)',[o.insertId,item.materialId,item.cantidad,item.precioCRC]);await audit(req.user!.id,'CREAR','ordenes_compra',String(o.insertId));await c.commit();res.status(201).json({id:o.insertId,numero:v.numero,estado:'PENDIENTE'});}catch(e){await c.rollback();throw e;}finally{c.release();}}));
app.post('/api/recepciones',allowRoles('ADMIN','COMPRAS','BODEGA'),asyncRoute(async(req:AuthedRequest,res:any)=>{const v=z.object({numero:z.string().min(3).max(48),ordenId:z.coerce.number().positive(),ubicacionId:z.coerce.number().positive(),documento:z.string().min(2).max(160),items:z.array(z.object({ordenDetalleId:z.coerce.number().positive(),cantidad:z.coerce.number().positive()})).min(1)}).parse(req.body);const c=await pool.getConnection();try{await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.beginTransaction();const [existing]=await c.execute<any[]>('SELECT id FROM recepciones WHERE numero=?',[v.numero]);if(existing.length){await c.commit();return res.json({id:existing[0].id,replayed:true});}const [order]=await c.execute<any[]>("SELECT id,estado FROM ordenes_compra WHERE id=? AND estado IN('APROBADA','PARCIAL') FOR UPDATE",[v.ordenId]);if(!order.length)throw Object.assign(new Error('La orden debe estar aprobada antes de recibir'),{status:409});const [rec]:any=await c.execute('INSERT INTO recepciones(numero,orden_id,ubicacion_id,documento,recibido_por) VALUES(?,?,?,?,?)',[v.numero,v.ordenId,v.ubicacionId,v.documento,req.user!.id]);for(const line of v.items){const [ol]=await c.execute<any[]>('SELECT id,material_id,cantidad FROM orden_compra_detalle WHERE id=? AND orden_id=? FOR UPDATE',[line.ordenDetalleId,v.ordenId]);if(!ol.length)throw Object.assign(new Error('La línea no pertenece a esta orden'),{status:422});const [sum]=await c.execute<any[]>('SELECT COALESCE(SUM(rd.cantidad),0) recibida FROM recepcion_detalle rd JOIN recepciones r ON r.id=rd.recepcion_id WHERE rd.orden_detalle_id=?',[line.ordenDetalleId]);if(Number(sum[0].recibida)+line.cantidad>Number(ol[0].cantidad))throw Object.assign(new Error('La cantidad supera lo pendiente de recibir'),{status:409});const [rd]:any=await c.execute('INSERT INTO recepcion_detalle(recepcion_id,orden_detalle_id,cantidad) VALUES(?,?,?)',[rec.insertId,line.ordenDetalleId,line.cantidad]);await c.execute("INSERT INTO movimientos_stock(material_id,cantidad,tipo,ubicacion_destino_id,usuario_id,documento,motivo,idempotency_key,recepcion_detalle_id) VALUES(?,?,'ENTRADA',?,?,?,?,?,?)",[ol[0].material_id,line.cantidad,v.ubicacionId,req.user!.id,v.documento,`Recepción vinculada a ${v.numero}`,`receipt-${v.numero}-${line.ordenDetalleId}`,rd.insertId]);}const [pending]=await c.execute<any[]>(`SELECT COUNT(*) n FROM orden_compra_detalle od WHERE od.orden_id=? AND od.cantidad>(SELECT COALESCE(SUM(rd.cantidad),0) FROM recepcion_detalle rd WHERE rd.orden_detalle_id=od.id)`,[v.ordenId]);await c.execute('UPDATE ordenes_compra SET estado=? WHERE id=?',[Number(pending[0].n)?'PARCIAL':'RECIBIDA',v.ordenId]);await c.commit();res.status(201).json({id:rec.insertId,replayed:false});}catch(e){await c.rollback();throw e;}finally{c.release();}}));
app.get('/api/ordenes',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query<any[]>(`SELECT oc.*,p.nombre proveedor,a.nombre area,ROUND(SUM(od.cantidad*od.precio_unitario_historico),2) total_crc,COUNT(od.id) lineas FROM ordenes_compra oc JOIN proveedores p ON p.id=oc.proveedor_id JOIN areas a ON a.id=oc.area_id JOIN orden_compra_detalle od ON od.orden_id=oc.id GROUP BY oc.id ORDER BY oc.fecha DESC`);res.json(r);}));
app.get('/api/ordenes/posibles-duplicados',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query<any[]>(`SELECT a.numero oc_a,b.numero oc_b,p.nombre proveedor,m.nombre material,da.cantidad cantidad_a,db.cantidad cantidad_b,ABS(DATEDIFF(a.fecha,b.fecha)) dias,CONCAT('Mismo proveedor, material y cantidades; fechas separadas por ',ABS(DATEDIFF(a.fecha,b.fecha)),' días') explicacion FROM ordenes_compra a JOIN ordenes_compra b ON a.id<b.id AND a.proveedor_id=b.proveedor_id AND ABS(DATEDIFF(a.fecha,b.fecha))<=3 JOIN proveedores p ON p.id=a.proveedor_id JOIN orden_compra_detalle da ON da.orden_id=a.id JOIN orden_compra_detalle db ON db.orden_id=b.id AND db.material_id=da.material_id JOIN materiales m ON m.id=da.material_id WHERE ABS(da.cantidad-db.cantidad)<=GREATEST(da.cantidad,db.cantidad)*0.05`);res.json(r);}));
app.get('/api/ordenes/:id',asyncRoute(async(req:any,res:any)=>{const [order]=await pool.execute<any[]>('SELECT oc.*,p.nombre proveedor FROM ordenes_compra oc JOIN proveedores p ON p.id=oc.proveedor_id WHERE oc.id=?',[String(req.params.id)]);if(!order.length)return res.status(404).json({error:'Orden no encontrada'});const [lines]=await pool.execute<any[]>(`SELECT od.id ordenDetalleId,od.material_id materialId,m.nombre material,m.sku,od.cantidad,od.precio_unitario_historico precioCRC,COALESCE(SUM(rd.cantidad),0) recibida FROM orden_compra_detalle od JOIN materiales m ON m.id=od.material_id LEFT JOIN recepcion_detalle rd ON rd.orden_detalle_id=od.id WHERE od.orden_id=? GROUP BY od.id,m.id`,[String(req.params.id)]);res.json({...order[0],items:lines});}));
app.get('/api/reportes/fuga-valor',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query<any[]>(`SELECT oc.numero,oc.fecha,p.nombre proveedor,m.nombre material,od.cantidad,od.precio_unitario_historico precio_compra,cd.precio_crc precio_contrato,ROUND(GREATEST(od.precio_unitario_historico-cd.precio_crc,0)*od.cantidad,2) sobreprecio_crc FROM ordenes_compra oc JOIN proveedores p ON p.id=oc.proveedor_id JOIN orden_compra_detalle od ON od.orden_id=oc.id JOIN materiales m ON m.id=od.material_id LEFT JOIN contratos c ON c.activo=1 AND oc.fecha BETWEEN c.fecha_inicio AND COALESCE(c.fecha_fin,'9999-12-31') LEFT JOIN contrato_detalle cd ON cd.contrato_id=c.id AND cd.material_id=m.id ORDER BY oc.fecha`);res.json({items:r,totalCRC:overpriceTotal(r.map((x:any)=>({quantity:Number(x.cantidad),unitPrice:Number(x.precio_compra),contractPrice:x.precio_contrato===null?null:Number(x.precio_contrato)})))});}));
app.get('/api/reportes/gasto',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query<any[]>(`SELECT p.nombre proveedor,m.nombre material,SUM(od.cantidad) cantidad,SUM(od.cantidad*od.precio_unitario_historico) gasto_crc FROM orden_compra_detalle od JOIN ordenes_compra oc ON oc.id=od.orden_id JOIN proveedores p ON p.id=oc.proveedor_id JOIN materiales m ON m.id=od.material_id GROUP BY p.id,m.id ORDER BY gasto_crc DESC`);res.json(r);}));
app.get('/api/ai/status',(_req:any,res:any)=>res.json({configured:Boolean(env.geminiKey),model:env.geminiModel}));
app.get('/api/ai/marketing',allowRoles('ADMIN','FINANZAS','LECTOR'),asyncRoute(async(req:AuthedRequest,res:any)=>{const from=String(req.query.from||'2026-01-01').slice(0,10),to=String(req.query.to||'2026-12-31').slice(0,10);const [trend]=await pool.execute<any[]>(`SELECT DATE_FORMAT(fecha,'%Y-%m') periodo,ROUND(SUM(CASE WHEN estado IN('CONFIRMADA','DEVUELTA') THEN total_neto_crc ELSE 0 END),0) ventas,COUNT(*) pedidos,ROUND(SUM(CASE WHEN estado IN('CONFIRMADA','DEVUELTA') THEN cogs_crc ELSE 0 END),0) costo FROM ventas WHERE fecha>=? AND fecha<? GROUP BY DATE_FORMAT(fecha,'%Y-%m') ORDER BY periodo`,[from,`${to} 23:59:59`]);const [products]=await pool.execute<any[]>(`SELECT p.name producto,SUM(d.cantidad) unidades,ROUND(SUM(d.cantidad*d.precio_unitario_crc),0) ingresos FROM venta_detalle d JOIN ventas v ON v.id=d.venta_id AND v.estado IN('CONFIRMADA','DEVUELTA') JOIN store_variants sv ON sv.id=d.variante_id JOIN store_products p ON p.id=sv.product_id WHERE v.fecha>=? AND v.fecha<? GROUP BY p.id,p.name ORDER BY unidades DESC,ingresos DESC LIMIT 6`,[from,`${to} 23:59:59`]);const [stock]=await pool.execute<any[]>(`SELECT p.name producto,sv.sku,sv.low_stock_threshold minimo,COALESCE(SUM(CASE WHEN ms.ubicacion_destino_id=loc.id THEN ms.cantidad ELSE 0 END)-SUM(CASE WHEN ms.ubicacion_origen_id=loc.id THEN ms.cantidad ELSE 0 END),0) stock FROM store_variants sv JOIN store_products p ON p.id=sv.product_id JOIN materiales m ON m.id=sv.material_id JOIN ubicaciones loc ON loc.codigo='BOD-CENTRAL' LEFT JOIN movimientos_stock ms ON ms.material_id=m.id WHERE sv.active=1 GROUP BY sv.id,p.id,p.name,sv.sku,sv.low_stock_threshold ORDER BY stock ASC LIMIT 8`,[]);const metrics={trend:trend.map((x:any)=>({period:String(x.periodo),sales:Number(x.ventas||0),orders:Number(x.pedidos||0),cost:Number(x.costo||0)})),topProducts:products.map((x:any)=>({product:x.producto,units:Number(x.unidades||0),revenue:Number(x.ingresos||0)})),lowStock:stock.map((x:any)=>({product:x.producto,sku:x.sku,stock:Number(x.stock||0),minimum:Number(x.minimo||0)}))};let recommendations='Configura GEMINI_API_KEY para obtener recomendaciones personalizadas.';if(env.geminiKey){try{recommendations=await askGemini('Actúa como estratega de mercadeo para una tienda de skate. Entrega 3 acciones concretas, priorizadas y medibles para aumentar ingresos, usando únicamente estos datos. No inventes cifras.',metrics);}catch(error){console.error('Marketing AI unavailable:',(error as any)?.status||(error as any)?.message);recommendations=`Gemini no está disponible temporalmente (${env.geminiModel}). Los indicadores siguen funcionando; revisa GEMINI_API_KEY y ejecuta npm run ai:smoke.`;}}res.json({configured:Boolean(env.geminiKey),model:env.geminiModel,metrics,recommendations});}));
app.post('/api/ai/chat',allowRoles('ADMIN','COMPRAS','BODEGA','FINANZAS','LECTOR'),rateLimit({windowMs:60_000,limit:8}),asyncRoute(async(req:AuthedRequest,res:any)=>{const q=z.string().min(3).max(1000).parse(req.body.question);const [stock]=await pool.query<any[]>(`SELECT m.id materialId,m.sku,m.nombre,u.nombre ubicacion,COALESCE(SUM(CASE WHEN ms.ubicacion_destino_id=u.id THEN ms.cantidad ELSE 0 END)-SUM(CASE WHEN ms.ubicacion_origen_id=u.id THEN ms.cantidad ELSE 0 END),0) stock,ps.demanda_prom,ps.demanda_max,ps.lead_time_dias FROM politicas_stock ps JOIN materiales m ON m.id=ps.material_id JOIN ubicaciones u ON u.id=ps.ubicacion_id LEFT JOIN movimientos_stock ms ON ms.material_id=m.id GROUP BY ps.id,m.id,u.id`);const [dups]=await pool.query<any[]>(`SELECT a.numero oc_a,b.numero oc_b,m.sku,m.nombre material,p.nombre proveedor,da.cantidad cantidad_a,db.cantidad cantidad_b,ABS(DATEDIFF(a.fecha,b.fecha)) dias FROM ordenes_compra a JOIN ordenes_compra b ON a.id<b.id AND a.proveedor_id=b.proveedor_id AND ABS(DATEDIFF(a.fecha,b.fecha))<=3 JOIN proveedores p ON p.id=a.proveedor_id JOIN orden_compra_detalle da ON da.orden_id=a.id JOIN orden_compra_detalle db ON db.orden_id=b.id AND db.material_id=da.material_id JOIN materiales m ON m.id=da.material_id WHERE ABS(da.cantidad-db.cantidad)<=GREATEST(da.cantidad,db.cantidad)*0.05`);const [overpriceRows]=await pool.query<any[]>(`SELECT od.cantidad,od.precio_unitario_historico precio,cd.precio_crc contrato FROM ordenes_compra oc JOIN orden_compra_detalle od ON od.orden_id=oc.id JOIN materiales m ON m.id=od.material_id LEFT JOIN contratos c ON c.activo=1 AND oc.fecha BETWEEN c.fecha_inicio AND COALESCE(c.fecha_fin,'9999-12-31') LEFT JOIN contrato_detalle cd ON cd.contrato_id=c.id AND cd.material_id=m.id`);const [recentOrders]=await pool.query<any[]>(`SELECT oc.id,oc.numero,oc.fecha,oc.estado,p.nombre proveedor FROM ordenes_compra oc JOIN proveedores p ON p.id=oc.proveedor_id ORDER BY oc.fecha DESC LIMIT 10`);const [trace]=await pool.query<any[]>(`SELECT ms.id,m.sku,m.nombre material,ms.cantidad,ms.documento,rc.numero recepcion,rc.documento documento_recepcion,oc.numero orden_compra FROM movimientos_stock ms JOIN materiales m ON m.id=ms.material_id LEFT JOIN recepcion_detalle rd ON rd.id=ms.recepcion_detalle_id LEFT JOIN recepciones rc ON rc.id=rd.recepcion_id LEFT JOIN orden_compra_detalle od ON od.id=rd.orden_detalle_id LEFT JOIN ordenes_compra oc ON oc.id=od.orden_id WHERE ms.tipo='ENTRADA' ORDER BY ms.created_at DESC LIMIT 10`);const context={stock,reorder:stock.map((x:any)=>({...x,ss:(x.demanda_max-x.demanda_prom)*x.lead_time_dias,pr:x.demanda_prom*x.lead_time_dias+(x.demanda_max-x.demanda_prom)*x.lead_time_dias})),possibleDuplicates:dups,overpriceCRC:overpriceTotal(overpriceRows.map((x:any)=>({quantity:Number(x.cantidad),unitPrice:Number(x.precio),contractPrice:x.contrato===null?null:Number(x.contrato)}))),recentOrders,traceability:trace};const answer=await askGemini(q,context);await pool.execute('INSERT INTO ai_consultas(usuario_id,pregunta,referencias_json) VALUES(?,?,?)',[req.user!.id,q,JSON.stringify({materials:stock.map((x:any)=>x.materialId),orders:dups})]);res.json({answer,source:'gemini-api',references:{materials:stock.map((x:any)=>({id:x.materialId,sku:x.sku})),orders:dups}});}));
app.post('/api/ordenes/:id/rechazar',allowRoles('ADMIN','COMPRAS','FINANZAS'),asyncRoute(async(req:AuthedRequest,res:any)=>{const v=z.object({comentario:z.string().min(2).max(500)}).parse(req.body);const c=await pool.getConnection();try{await c.beginTransaction();const [r]=await c.execute<any[]>('SELECT * FROM ordenes_compra WHERE id=? FOR UPDATE',[String(req.params.id)]);if(!r.length)throw Object.assign(new Error('Orden no encontrada'),{status:404});if(r[0].estado!=='PENDIENTE')throw Object.assign(new Error('Solo se pueden rechazar órdenes pendientes'),{status:409});if(r[0].comprador_id===req.user!.id)throw Object.assign(new Error('La persona solicitante no puede decidir su propia orden'),{status:409});await c.execute("UPDATE ordenes_compra SET estado='RECHAZADA' WHERE id=?",[String(req.params.id)]);await c.execute("INSERT INTO aprobaciones(orden_id,usuario_id,decision,comentario) VALUES(?,?,'RECHAZADA',?)",[String(req.params.id),req.user!.id,v.comentario]);await c.commit();res.json({ok:true});}catch(e){await c.rollback();throw e;}finally{c.release();}}));
app.get('/api/cotizaciones',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query<any[]>(`SELECT c.*,p.nombre proveedor,rq.numero requisicion,ROUND(SUM(d.cantidad*d.precio_unitario_crc),2) total_crc FROM cotizaciones c JOIN proveedores p ON p.id=c.proveedor_id JOIN requisiciones rq ON rq.id=c.requisicion_id JOIN cotizacion_detalle d ON d.cotizacion_id=c.id GROUP BY c.id ORDER BY c.fecha DESC`);res.json(r);}));
app.get('/api/facturas',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query<any[]>(`SELECT f.*,oc.numero orden_compra,COALESCE(SUM(p.monto_crc),0) pagado_crc FROM facturas f JOIN ordenes_compra oc ON oc.id=f.orden_id LEFT JOIN pagos_registrados p ON p.factura_id=f.id GROUP BY f.id ORDER BY f.fecha DESC`);res.json(r);}));
app.get('/api/pagos-registrados',asyncRoute(async(_req:any,res:any)=>{const [r]=await pool.query<any[]>(`SELECT p.*,f.numero factura,oc.numero orden_compra FROM pagos_registrados p JOIN facturas f ON f.id=p.factura_id JOIN ordenes_compra oc ON oc.id=f.orden_id ORDER BY p.fecha DESC`);res.json(r);}));
app.post('/api/ordenes/:id/aprobar',allowRoles('ADMIN','COMPRAS','FINANZAS'),asyncRoute(async(req:AuthedRequest,res:any)=>{const c=await pool.getConnection();try{await c.beginTransaction();const [r]=await c.execute<any[]>('SELECT * FROM ordenes_compra WHERE id=? FOR UPDATE',[String(req.params.id)]);if(!r.length)return res.status(404).json({error:'Orden no encontrada'});if(r[0].estado!=='PENDIENTE')return res.status(409).json({error:'Solo se pueden aprobar órdenes pendientes'});if(r[0].comprador_id===req.user!.id)return res.status(409).json({error:'No se permite autoaprobar una orden propia'});await c.execute("UPDATE ordenes_compra SET estado='APROBADA' WHERE id=?",[String(req.params.id)]);await c.execute("INSERT INTO aprobaciones(orden_id,usuario_id,decision) VALUES(?,?,'APROBADA')",[String(req.params.id),req.user!.id]);await c.commit();res.json({ok:true});}catch(e){await c.rollback();throw e;}finally{c.release();}}));
async function audit(user:number,action:string,entity:string,id:string){await pool.execute('INSERT INTO auditoria_eventos(usuario_id,accion,entidad,entidad_id) VALUES(?,?,?,?)',[user,action,entity,id]);}
app.get('/api/admin/dashboard/summary',allowRoles('ADMIN','FINANZAS','LECTOR'),asyncRoute(async(req:any,res:any)=>{
  const from=String(req.query.from||'2026-01-01').slice(0,10),to=String(req.query.to||'2026-12-31').slice(0,10);
  const [[sales]]=await pool.execute<any[]>(`SELECT COUNT(*) orders,
    SUM(estado='CONFIRMADA') confirmed,
    SUM(estado='PENDIENTE') pending,
    COALESCE(SUM(CASE WHEN estado IN('CONFIRMADA','DEVUELTA') THEN subtotal_crc ELSE 0 END),0) gross,
    COALESCE(SUM(CASE WHEN estado IN('CONFIRMADA','DEVUELTA') THEN descuento_crc ELSE 0 END),0) discounts,
    COALESCE(SUM(CASE WHEN estado IN('CONFIRMADA','DEVUELTA') THEN devolucion_crc ELSE 0 END),0) returns,
    COALESCE(SUM(CASE WHEN estado IN('CONFIRMADA','DEVUELTA') THEN total_neto_crc ELSE 0 END),0) net,
    COALESCE(SUM(CASE WHEN estado IN('CONFIRMADA','DEVUELTA') THEN cogs_crc ELSE 0 END),0) cogs
    FROM ventas WHERE fecha>=? AND fecha<?`,[from,`${to} 23:59:59`]);
  const [[customerOrders]]=await pool.execute<any[]>(`SELECT
    SUM(status='PENDING') pending,
    SUM(status='ACCEPTED') accepted,
    SUM(status='CANCELLED') cancelled
    FROM customer_orders WHERE created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY)`,[from,to]);
  const [[collections]]=await pool.execute<any[]>(`SELECT COALESCE(SUM(CASE WHEN event_type='PAYMENT' THEN amount_crc ELSE -amount_crc END),0) total
    FROM customer_order_payment_events WHERE occurred_at>=? AND occurred_at<DATE_ADD(?,INTERVAL 1 DAY)`,[from,to]);
  const [[expenses]]=await pool.execute<any[]>(`SELECT COALESCE(SUM(monto_crc),0) total FROM gastos WHERE estado='REGISTRADO' AND fecha BETWEEN ? AND ?`,[from,to]);
  const [[payables]]=await pool.execute<any[]>(`SELECT COALESCE(SUM(c.importe_crc-COALESCE(a.paid,0)),0) balance,COALESCE(SUM(CASE WHEN c.fecha_vencimiento<CURDATE() THEN c.importe_crc-COALESCE(a.paid,0) ELSE 0 END),0) overdue FROM cuentas_por_pagar c LEFT JOIN (SELECT cuenta_id,SUM(monto_crc) paid FROM abonos_cuenta GROUP BY cuenta_id) a ON a.cuenta_id=c.id WHERE c.estado='ABIERTA'`);
  const [[inventory]]=await pool.execute<any[]>(`SELECT COUNT(DISTINCT v.id) skus,COALESCE(SUM(COALESCE(incoming.units,0)-COALESCE(outgoing.units,0)),0) units FROM store_variants v JOIN materiales m ON m.id=v.material_id LEFT JOIN (SELECT material_id,SUM(cantidad) units FROM movimientos_stock WHERE ubicacion_destino_id IS NOT NULL GROUP BY material_id) incoming ON incoming.material_id=m.id LEFT JOIN (SELECT material_id,SUM(cantidad) units FROM movimientos_stock WHERE ubicacion_origen_id IS NOT NULL GROUP BY material_id) outgoing ON outgoing.material_id=m.id WHERE v.active=1`);
  const [[clients]]=await pool.execute<any[]>('SELECT COUNT(*) total FROM clientes WHERE activo=1');
  res.json({period:{from,to},demoMode:true,paymentsIntegrated:true,collectedRevenue:Number(collections.total||0),kpis:{products:Number(inventory.skus||0),skus:Number(inventory.skus||0),units:Number(inventory.units||0),orders:Number(sales.orders||0),confirmedOrders:Number(sales.confirmed||0),pendingOrders:Number(sales.pending||0),pendingCustomerOrders:Number(customerOrders.pending||0),acceptedCustomerOrders:Number(customerOrders.accepted||0),cancelledCustomerOrders:Number(customerOrders.cancelled||0),clients:Number(clients.total||0),gross:Number(sales.gross||0),discounts:Number(sales.discounts||0),returns:Number(sales.returns||0),net:Number(sales.net||0),cogs:Number(sales.cogs||0),grossProfit:Number(sales.net||0)-Number(sales.cogs||0),operatingExpenses:Number(expenses.total||0),operatingProfit:Number(sales.net||0)-Number(sales.cogs||0)-Number(expenses.total||0),payableBalance:Number(payables.balance||0),overduePayables:Number(payables.overdue||0)}});
}));
app.get('/api/admin/ventas',allowRoles('ADMIN','FINANZAS','LECTOR'),asyncRoute(async(req:any,res:any)=>{const from=String(req.query.from||'2026-01-01').slice(0,10),to=String(req.query.to||'2026-12-31').slice(0,10);const [rows]=await pool.execute<any[]>(`SELECT v.referencia,v.estado,v.fecha,v.total_neto_crc total,c.nombre cliente,COUNT(d.id) lineas FROM ventas v JOIN clientes c ON c.id=v.cliente_id LEFT JOIN venta_detalle d ON d.venta_id=v.id WHERE v.fecha>=? AND v.fecha<? GROUP BY v.id,c.id ORDER BY v.fecha DESC LIMIT 500`,[from,`${to} 23:59:59`]);res.json(rows); }));
app.get('/api/admin/gastos',allowRoles('ADMIN','FINANZAS','LECTOR'),asyncRoute(async(req:any,res:any)=>{const from=String(req.query.from||'2026-01-01').slice(0,10),to=String(req.query.to||'2026-12-31').slice(0,10);const [rows]=await pool.execute<any[]>(`SELECT g.referencia,g.descripcion,g.fecha,g.monto_crc monto,c.nombre categoria FROM gastos g JOIN categorias_gasto c ON c.id=g.categoria_id WHERE g.estado='REGISTRADO' AND g.fecha BETWEEN ? AND ? ORDER BY g.fecha DESC`,[from,to]);res.json(rows); }));
app.get('/api/admin/cuentas-por-pagar',allowRoles('ADMIN','FINANZAS','LECTOR'),asyncRoute(async(_req:any,res:any)=>{const [rows]=await pool.query<any[]>(`SELECT c.referencia,p.nombre proveedor,c.fecha_vencimiento,c.importe_crc importe,COALESCE(a.paid,0) abonado,c.importe_crc-COALESCE(a.paid,0) saldo FROM cuentas_por_pagar c JOIN proveedores p ON p.id=c.proveedor_id LEFT JOIN (SELECT cuenta_id,SUM(monto_crc) paid FROM abonos_cuenta GROUP BY cuenta_id) a ON a.cuenta_id=c.id WHERE c.estado<>'ANULADA' ORDER BY c.fecha_vencimiento`);res.json(rows); }));
app.get('/api/admin/inventario',allowRoles('ADMIN','BODEGA','LECTOR'),asyncRoute(async(_req:any,res:any)=>{const [rows]=await pool.query<any[]>(`SELECT m.sku,m.nombre material,v.id variante_id,v.size_in medida,COALESCE(incoming.units,0)-COALESCE(outgoing.units,0) stock,v.low_stock_threshold minimo,v.sale_price_crc precio FROM store_variants v JOIN materiales m ON m.id=v.material_id LEFT JOIN (SELECT material_id,SUM(cantidad) units FROM movimientos_stock WHERE ubicacion_destino_id IS NOT NULL GROUP BY material_id) incoming ON incoming.material_id=m.id LEFT JOIN (SELECT material_id,SUM(cantidad) units FROM movimientos_stock WHERE ubicacion_origen_id IS NOT NULL GROUP BY material_id) outgoing ON outgoing.material_id=m.id WHERE v.active=1 ORDER BY m.nombre`);res.json(rows); }));
app.use((err:any,req:any,res:any,_next:any)=>{if(err instanceof z.ZodError)return res.status(422).json({error:'Validación fallida',details:err.issues.map((x:any)=>({path:x.path,message:x.message}))});const status=err.status||(err.message==='Origen no permitido'?403:err.code==='ER_DUP_ENTRY'?409:500);if(status>=500)console.error('API error',{requestId:req.headers['x-request-id'],method:req.method,path:req.originalUrl,code:err.code||null,name:err.name||'Error',message:err.message||'Error desconocido'});res.status(status).json({error:status>=500?'Error interno del servidor':err.message||'Solicitud inválida'});});
