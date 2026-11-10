import mysql from 'mysql2/promise';
import {env} from '../config/env.js';

const db=await mysql.createConnection({host:env.dbHost,port:env.dbPort,database:env.dbName,user:env.dbUser,password:env.dbPassword});
const batchCode='SKATE-DEMO-FINANCE-2026';
try{
  await db.beginTransaction();
  await db.execute(`INSERT INTO demo_batches(codigo,descripcion,es_activo) VALUES(?,?,TRUE) ON DUPLICATE KEY UPDATE descripcion=VALUES(descripcion),es_activo=TRUE`,[batchCode,'Escenario ficticio de seis meses para demostración']);
  const [[batch]]=await db.query<any[]>('SELECT id FROM demo_batches WHERE codigo=?',[batchCode]);
  const batchId=Number(batch.id);
  const categories:Array<[string,string]>=[['ALQUILER','Alquiler'],['SERVICIOS','Servicios'],['TRANSPORTE','Transporte'],['EMPAQUE','Empaque'],['PUBLICIDAD','Publicidad'],['SOFTWARE','Software'],['MANTENIMIENTO','Mantenimiento'],['COMISIONES','Comisiones']];
  for(const [code,name] of categories)await db.execute('INSERT INTO categorias_gasto(codigo,nombre) VALUES(?,?) ON DUPLICATE KEY UPDATE nombre=VALUES(nombre)',[code,name]);
  for(let i=1;i<=30;i++)await db.execute(`INSERT INTO clientes(codigo,nombre,email,telefono,demo_batch_id) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE nombre=VALUES(nombre),telefono=VALUES(telefono),demo_batch_id=VALUES(demo_batch_id)`,[`CLI-DEMO-${String(i).padStart(3,'0')}`,`Cliente Demo ${String(i).padStart(2,'0')}`,`cliente${i}@demo.test`,`8888-${String(1000+i).slice(-4)}`,batchId]);
  const [clientRows]=await db.query<any[]>('SELECT id,codigo FROM clientes WHERE demo_batch_id=? ORDER BY codigo',[batchId]);
  const [[variant]]=await db.query<any[]>('SELECT id,sale_price_crc FROM store_variants ORDER BY id LIMIT 1');
  const [variants]=await db.query<any[]>('SELECT id,sale_price_crc FROM store_variants ORDER BY id LIMIT 40');
  if(!variant||!variants.length)throw new Error('Se requieren variantes de tienda antes de cargar la demo financiera');
  for(let i=1;i<=180;i++){
    const status=i%12===0?'CANCELADA':i%10===0?'DEVUELTA':i%4===0?'PENDIENTE':'CONFIRMADA';
    const clientId=Number(clientRows[(i-1)%clientRows.length].id);
    const date=new Date(Date.UTC(2026,4+(i%6),((i-1)%27)+1,12,0,0));
    const v=variants[(i-1)%variants.length];
    const price=Number(v.sale_price_crc),qty=1+(i%3===0?1:0),discount=i%7===0?Math.round(price*.1):0;
    const subtotal=price*qty,refund=status==='DEVUELTA'?Math.round(subtotal*.5):0,net=status==='CANCELADA'?0:subtotal-discount-refund,cost=Math.round(price*.46)*qty;
    await db.execute(`INSERT INTO ventas(referencia,cliente_id,estado,subtotal_crc,descuento_crc,devolucion_crc,total_neto_crc,cogs_crc,fecha,demo_batch_id) VALUES(?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE estado=VALUES(estado),subtotal_crc=VALUES(subtotal_crc),descuento_crc=VALUES(descuento_crc),devolucion_crc=VALUES(devolucion_crc),total_neto_crc=VALUES(total_neto_crc),cogs_crc=VALUES(cogs_crc)`,[`VTA-DEMO-${String(i).padStart(4,'0')}`,clientId,status,subtotal,discount,refund,net,status==='CANCELADA'?0:cost,date,batchId]);
    const [[sale]]=await db.query<any[]>('SELECT id FROM ventas WHERE referencia=?',[`VTA-DEMO-${String(i).padStart(4,'0')}`]);
    await db.execute(`INSERT INTO venta_detalle(venta_id,variante_id,cantidad,precio_unitario_crc,costo_unitario_crc) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE cantidad=VALUES(cantidad),precio_unitario_crc=VALUES(precio_unitario_crc),costo_unitario_crc=VALUES(costo_unitario_crc)`,[sale.id,v.id,qty,price,Math.round(price*.46)]);
  }
  const [expenseCats]=await db.query<any[]>('SELECT id,codigo FROM categorias_gasto ORDER BY id');
  for(let i=1;i<=36;i++){
    const cat=expenseCats[(i-1)%expenseCats.length];
    const amount=25000+(i%8)*12500;
    const date=`2026-${String(5+(i%6)).padStart(2,'0')}-${String((i%27)+1).padStart(2,'0')}`;
    await db.execute(`INSERT INTO gastos(referencia,categoria_id,descripcion,monto_crc,fecha,demo_batch_id) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE monto_crc=VALUES(monto_crc),fecha=VALUES(fecha)`,[`GAS-DEMO-${String(i).padStart(3,'0')}`,cat.id,`Gasto demo ${cat.codigo.toLowerCase()} ${i}`,amount,date,batchId]);
  }
  const [suppliers]=await db.query<any[]>('SELECT id FROM proveedores ORDER BY id LIMIT 6');
  for(let i=1;i<=6;i++){
    const supplier=suppliers[(i-1)%suppliers.length];
    const amount=180000+i*27500;
    await db.execute(`INSERT INTO cuentas_por_pagar(referencia,proveedor_id,fecha_emision,fecha_vencimiento,importe_crc,estado,demo_batch_id) VALUES(?,?,?,?,?,'ABIERTA',?) ON DUPLICATE KEY UPDATE importe_crc=VALUES(importe_crc),fecha_vencimiento=VALUES(fecha_vencimiento)`,[`CPP-DEMO-${String(i).padStart(3,'0')}`,supplier.id,`2026-${String(5+i).padStart(2,'0')}-05`,`2026-${String(6+i).padStart(2,'0')}-05`,amount,batchId]);
    const [[account]]=await db.query<any[]>('SELECT id FROM cuentas_por_pagar WHERE referencia=?',[`CPP-DEMO-${String(i).padStart(3,'0')}`]);
    await db.execute(`INSERT INTO abonos_cuenta(cuenta_id,referencia,fecha,monto_crc) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE monto_crc=VALUES(monto_crc)`,[account.id,`ABO-DEMO-${String(i).padStart(3,'0')}`,`2026-${String(6+i).padStart(2,'0')}-01`,i%2===0?Math.round(amount*.35):Math.round(amount*.15)]);
  }
  await db.commit();
  console.log('Demo financiera aplicada: 30 clientes, 180 ventas, 36 gastos y 6 cuentas por pagar.');
}catch(error){await db.rollback();throw error;}finally{await db.end();}
