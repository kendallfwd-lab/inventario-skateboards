USE del_valle_inventory;
-- material N:M proveedor
SELECT m.sku,m.nombre,p.codigo,p.nombre FROM proveedor_material pm JOIN materiales m ON m.id=pm.material_id JOIN proveedores p ON p.id=pm.proveedor_id ORDER BY m.sku,p.codigo;
-- usuario N:M rol
SELECT u.email,r.codigo FROM usuario_rol ur JOIN usuarios u ON u.id=ur.usuario_id JOIN roles r ON r.id=ur.rol_id;
-- material N:M ubicaciones con política de reorden
SELECT m.sku,u.codigo,ps.demanda_prom,ps.demanda_max,ps.lead_time_dias FROM politicas_stock ps JOIN materiales m ON m.id=ps.material_id JOIN ubicaciones u ON u.id=ps.ubicacion_id;
-- OC N:M material y valor contractual sin duplicar las líneas
SELECT o.numero,m.sku,d.cantidad,d.precio_unitario_historico FROM orden_compra_detalle d JOIN ordenes_compra o ON o.id=d.orden_id JOIN materiales m ON m.id=d.material_id ORDER BY o.numero;
-- saldo derivado del ledger
SELECT m.sku,u.codigo,SUM(CASE WHEN ms.ubicacion_destino_id=u.id THEN ms.cantidad ELSE 0 END)-SUM(CASE WHEN ms.ubicacion_origen_id=u.id THEN ms.cantidad ELSE 0 END) stock FROM movimientos_stock ms JOIN materiales m ON m.id=ms.material_id JOIN ubicaciones u ON u.id=COALESCE(ms.ubicacion_destino_id,ms.ubicacion_origen_id) GROUP BY m.id,u.id;
