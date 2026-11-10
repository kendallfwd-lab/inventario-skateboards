USE del_valle_inventory;

-- Servidor y conexión activa. No muestra contraseñas.
SELECT VERSION() AS mysql_version,
       @@version_comment AS distribution,
       @@port AS internal_server_port,
       DATABASE() AS active_database,
       CURRENT_USER() AS authenticated_account;
SHOW GRANTS FOR CURRENT_USER();

-- Esquema disponible.
SHOW TABLES;
SELECT COUNT(*) AS table_count
FROM information_schema.tables
WHERE table_schema = DATABASE();

SELECT
  (SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()) AS foreign_keys,
  (SELECT COUNT(*) FROM (SELECT DISTINCT table_name,index_name FROM information_schema.statistics WHERE table_schema = DATABASE()) indexes_found) AS indexes_count,
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND constraint_type = 'CHECK') AS check_constraints;

-- Conteos principales de la demostración.
SELECT 'store_products' AS entity, COUNT(*) AS total FROM store_products
UNION ALL SELECT 'store_variants', COUNT(*) FROM store_variants
UNION ALL SELECT 'clientes', COUNT(*) FROM clientes
UNION ALL SELECT 'ventas', COUNT(*) FROM ventas
UNION ALL SELECT 'gastos', COUNT(*) FROM gastos
UNION ALL SELECT 'cuentas_por_pagar', COUNT(*) FROM cuentas_por_pagar
UNION ALL SELECT 'abonos_cuenta', COUNT(*) FROM abonos_cuenta
UNION ALL SELECT 'proveedores', COUNT(*) FROM proveedores
UNION ALL SELECT 'movimientos_stock', COUNT(*) FROM movimientos_stock;

-- Catálogo, precio y saldo derivado exclusivamente del libro de movimientos.
SELECT p.name AS producto,
       v.sku,
       v.size_in AS medida,
       v.sale_price_crc AS precio_crc,
       COALESCE(SUM(CASE WHEN ms.ubicacion_destino_id=u.id THEN ms.cantidad ELSE 0 END),0)
       - COALESCE(SUM(CASE WHEN ms.ubicacion_origen_id=u.id THEN ms.cantidad ELSE 0 END),0) AS existencias
FROM store_products p
JOIN store_variants v ON v.product_id=p.id
JOIN materiales m ON m.id=v.material_id
JOIN ubicaciones u ON u.codigo='BOD-CENTRAL'
LEFT JOIN movimientos_stock ms ON ms.material_id=m.id
WHERE p.active=1 AND v.active=1
GROUP BY p.id,v.id,u.id
ORDER BY p.name,v.size_in;

-- Debe devolver cero filas: no se permiten saldos negativos.
WITH balances AS (
  SELECT v.id,v.sku,
         COALESCE(SUM(CASE WHEN ms.ubicacion_destino_id=u.id THEN ms.cantidad ELSE 0 END),0)
         - COALESCE(SUM(CASE WHEN ms.ubicacion_origen_id=u.id THEN ms.cantidad ELSE 0 END),0) AS stock
  FROM store_variants v
  JOIN materiales m ON m.id=v.material_id
  JOIN ubicaciones u ON u.codigo='BOD-CENTRAL'
  LEFT JOIN movimientos_stock ms ON ms.material_id=m.id
  GROUP BY v.id,u.id
)
SELECT * FROM balances WHERE stock<0;

-- Movimientos recientes y alertas abiertas.
SELECT ms.id,m.sku,m.nombre,ms.tipo,ms.cantidad,ms.documento,ms.created_at
FROM movimientos_stock ms
JOIN materiales m ON m.id=ms.material_id
ORDER BY ms.created_at DESC,ms.id DESC
LIMIT 25;

SELECT a.id,m.sku,m.nombre,a.stock_actual,a.punto_reorden,a.estado,a.mensaje
FROM alertas a
JOIN materiales m ON m.id=a.material_id
WHERE a.estado<>'RESUELTA'
ORDER BY a.created_at DESC;

-- Ventas por estado. PENDIENTE y CANCELADA no se reconocen como ingresos.
SELECT estado,COUNT(*) AS ventas,SUM(total_neto_crc) AS total_registrado_crc
FROM ventas
GROUP BY estado
ORDER BY estado;

-- Resultado financiero demostrativo sin multiplicar importes por joins de detalle.
WITH sales AS (
  SELECT
    COALESCE(SUM(CASE WHEN estado IN('CONFIRMADA','DEVUELTA') THEN total_neto_crc ELSE 0 END),0) AS net_sales,
    COALESCE(SUM(CASE WHEN estado IN('CONFIRMADA','DEVUELTA') THEN cogs_crc ELSE 0 END),0) AS cogs
  FROM ventas
), expenses AS (
  SELECT COALESCE(SUM(monto_crc),0) AS operating_expenses
  FROM gastos
  WHERE estado='REGISTRADO'
), paid AS (
  SELECT cuenta_id,SUM(monto_crc) AS amount
  FROM abonos_cuenta
  GROUP BY cuenta_id
), payables AS (
  SELECT COALESCE(SUM(c.importe_crc-COALESCE(p.amount,0)),0) AS payable_balance
  FROM cuentas_por_pagar c
  LEFT JOIN paid p ON p.cuenta_id=c.id
  WHERE c.estado='ABIERTA'
)
SELECT sales.net_sales AS ventas_netas_crc,
       sales.cogs AS costo_productos_crc,
       sales.net_sales-sales.cogs AS utilidad_bruta_crc,
       expenses.operating_expenses AS gastos_operativos_crc,
       sales.net_sales-sales.cogs-expenses.operating_expenses AS utilidad_operativa_estimada_crc,
       payables.payable_balance AS cuentas_pendientes_crc
FROM sales CROSS JOIN expenses CROSS JOIN payables;

-- Relaciones N:M y cuenta administrativa, sin exponer hashes.
SELECT m.sku,m.nombre,p.codigo,p.nombre
FROM proveedor_material pm
JOIN materiales m ON m.id=pm.material_id
JOIN proveedores p ON p.id=pm.proveedor_id
ORDER BY m.sku,p.codigo;

SELECT u.email,r.codigo AS rol,u.activo
FROM usuario_rol ur
JOIN usuarios u ON u.id=ur.usuario_id
JOIN roles r ON r.id=ur.rol_id
ORDER BY u.email,r.codigo;

SELECT m.sku,u.codigo,ps.demanda_prom,ps.demanda_max,ps.lead_time_dias
FROM politicas_stock ps
JOIN materiales m ON m.id=ps.material_id
JOIN ubicaciones u ON u.id=ps.ubicacion_id;

-- Deben devolver cero.
SELECT COUNT(*) AS orphan_variants
FROM store_variants v
LEFT JOIN store_products p ON p.id=v.product_id
LEFT JOIN materiales m ON m.id=v.material_id
WHERE p.id IS NULL OR m.id IS NULL;

SELECT COUNT(*) AS duplicate_idempotency_keys
FROM (
  SELECT idempotency_key
  FROM movimientos_stock
  WHERE idempotency_key IS NOT NULL
  GROUP BY idempotency_key
  HAVING COUNT(*)>1
) duplicates_found;
