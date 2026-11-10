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

El panel privado consulta estas métricas en `/api/admin/dashboard/summary` y muestra una etiqueta de modo demo cuando el periodo contiene datos ficticios.
