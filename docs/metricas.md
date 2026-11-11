# Métricas comerciales y datos demo

La migración `002_business_demo.sql` agrega el módulo comercial y financiero sin duplicar el libro de existencias.

- `clientes`, `ventas` y `venta_detalle`: ventas, estados, descuentos, devoluciones y costo histórico.
- `categorias_gasto` y `gastos`: gastos operativos registrados.
- `cuentas_por_pagar` y `abonos_cuenta`: obligaciones y saldo pendiente.
- `demo_batches`: identifica datos ficticios para filtrarlos o retirarlos de forma controlada.

`npm run db:seed` ejecuta también `business-seed.ts`. La semilla es idempotente y crea 30 clientes, 180 ventas, 36 gastos, 6 cuentas por pagar y 8 categorías para el periodo demo 2026.

## Fórmulas

- Ventas netas: total neto de ventas menos devoluciones registradas.
- Utilidad bruta: ventas netas menos `cogs_crc`.
- Utilidad operativa: utilidad bruta menos gastos registrados.
- Saldo por pagar: importe de la cuenta menos la suma de sus abonos.
- Existencias: entradas por ubicación menos salidas por ubicación, calculadas desde `movimientos_stock`; no se guarda un saldo mutable duplicado.

Las ventas del panel se calculan desde `ventas` y representan registros confirmados o devueltos; no prueban que el cliente haya pagado. Las solicitudes de la tienda (`customer_orders`) se cuentan aparte por estado pendiente, aceptado o cancelado. Los cobros netos de clientes se calculan desde `customer_order_payment_events` y `/api/admin/dashboard/summary` informa `paymentsIntegrated: true` junto a `collectedRevenue`; no se infieren de las ventas históricas. `pagos_registrados` registra pagos a proveedores, no cobros de clientes.

La migración `003_crm_customer_payments.sql` agrega perfiles y contactos CRM sobre `clientes`, eventos históricos de consentimiento, seguimientos, vínculos de pedido-cliente y `customer_order_payment_events`. Los cobros se registran únicamente para pedidos aceptados y hasta su saldo pendiente; los reembolsos se asocian a un cobro y no pueden superar el importe aún no devuelto. Ambos eventos requieren método, referencia, clave de idempotencia y usuario responsable. La interfaz administrativa distingue estas operaciones de las ventas históricas.

La migración `004_store_promotions.sql` agrega campañas con códigos únicos, descuento porcentual o fijo, subtotal mínimo, vigencia y límite opcional de usos. El checkout muestra una cotización validada y el servidor vuelve a validar el código y recalcula el subtotal dentro de la transacción al crear el pedido. Un pedido acepta un solo código; su redención y el descuento aplicado se guardan como snapshot, y pedidos cancelados liberan el cupo. No se envían comunicaciones promocionales ni se modifican precios base.

El panel privado consulta estas métricas en `/api/admin/dashboard/summary` y muestra una etiqueta de modo demo cuando el periodo contiene datos ficticios.
