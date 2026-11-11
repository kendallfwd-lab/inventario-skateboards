# DER — Del Valle Inventory AI (3FN)

```mermaid
erDiagram
  usuarios ||--o{ usuario_rol : asigna
  roles ||--o{ usuario_rol : contiene
  materiales ||--o{ proveedor_material : abastece
  proveedores ||--o{ proveedor_material : ofrece
  materiales ||--o{ politicas_stock : define
  ubicaciones ||--o{ politicas_stock : aplica
  materiales ||--o{ movimientos_stock : registra
  ubicaciones ||--o{ movimientos_stock : origen_destino
  ordenes_compra ||--|{ orden_compra_detalle : contiene
  materiales ||--o{ orden_compra_detalle : solicitado
  proveedores ||--o{ ordenes_compra : recibe
  ordenes_compra ||--o{ recepciones : respalda
  recepciones ||--|{ recepcion_detalle : contiene
  orden_compra_detalle ||--o{ recepcion_detalle : satisface
  materiales ||--o{ material_alias : normaliza
  contratos ||--|{ contrato_detalle : fija
  materiales ||--o{ contrato_detalle : precio
  requisiciones ||--|{ requisicion_detalle : solicita
  materiales ||--o{ requisicion_detalle : requerido
  requisiciones ||--o{ cotizaciones : cotizada
  proveedores ||--o{ cotizaciones : oferta
  cotizaciones ||--|{ cotizacion_detalle : desglosa
  proveedores ||--o{ evaluaciones_proveedor : evaluado
  criterios_evaluacion ||--o{ evaluacion_detalle : pondera
  evaluaciones_proveedor ||--|{ evaluacion_detalle : detalla
  ordenes_compra ||--o{ facturas : factura
  facturas ||--o{ pagos_registrados : registra
```

**Relaciones N:M verificables:** materiales↔proveedores (`proveedor_material`), materiales↔ubicaciones (`politicas_stock`), usuarios↔roles (`usuario_rol`), órdenes↔materiales (`orden_compra_detalle`). Cada tabla puente tiene FK y clave compuesta/única. El saldo se deriva de `movimientos_stock`, no se duplica en inventario. Precios/condiciones históricos están separados de catálogos.
  requisiciones ||--|{ requisicion_detalle : solicita
  materiales ||--o{ requisicion_detalle : requerido
  requisiciones ||--o{ cotizaciones : cotizada
  proveedores ||--o{ cotizaciones : oferta
  cotizaciones ||--|{ cotizacion_detalle : desglosa
  proveedores ||--o{ evaluaciones_proveedor : evaluado
  criterios_evaluacion ||--o{ evaluacion_detalle : pondera
  evaluaciones_proveedor ||--|{ evaluacion_detalle : detalla
  ordenes_compra ||--o{ facturas : factura
  facturas ||--o{ pagos_registrados : registra
