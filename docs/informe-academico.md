# Informe académico — Gestión de inventarios

**Caso ficticio:** Constructora Del Valle S.A. · Costa Rica · Quiz #2.

## A1. Circuito y aprobación

Requisición del área → validación de presupuesto y necesidad → cotizaciones → evaluación → aprobación independiente → orden de compra → recepción física contra OC → factura contra OC y recepción (three-way match) → registro de pago. Cada paso genera documento y responsable. La matriz del caso requiere 1 cotización hasta ₡250 000, 2 hasta ₡2 000 000, 3 hasta ₡10 000 000 y 3 más comité por encima. El umbral se calcula sobre compras relacionadas por proveedor/proyecto/categoría en una ventana temporal; bloqueos por fraccionamiento, aprobación por otra persona, registro de rechazo y bitácora reducen riesgo.

## A2. Taxonomía y gasto

- Materiales de construcción › Cemento y agregados: `CEM-GRIS-50`, `ARENA-M3`, `BLK-12-20-40`.
- Materiales de construcción › Acero de refuerzo: `VAR-03-G40` (grado y longitud se especifican para no fusionar equivalencias dudosas).
- Seguridad y protección › Guantes desechables: `GUA-NIT-L`; guantes reutilizables: `GUA-TRAB-L`.
- Instalaciones hidráulicas › Tubería PVC: `PVC-12-SDR135`.

Las líneas 1, 2 y 3 del quiz son cemento equivalente. La varilla #3 grado 40 no se debe fusionar con hierro sin confirmar grado y largo. Guante de nitrilo no es igual a guante de trabajo. Ahorro potencial cemento frente al menor precio observado de ₡6 300: 200×(₡6 450−₡6 300) + 40×(₡7 100−₡6 300) + 300×(₡6 300−₡6 300) = ₡62 000. Para varilla, la referencia mínima observada en esas líneas es ₡2 150: 60×(₡2 600−₡2 150) = ₡27 000; solo aplica si la equivalencia técnica se confirma. Para varilla el ahorro potencial es ₡27 000 solo si equivalencia técnica y precio aplicable se confirman. El dato semilla de gasto no se presenta como ahorro realizado.

## A3. Fuga de valor

OC-1041 y OC-1042 comparten fecha, proveedor, artículo y cantidad; son candidatas a duplicado, no prueba de duplicación. Comparación de líneas contra precios de contrato produce los importes del caso: ₡30 000, ₡30 000, ₡32 000, ₡50 000, ₡48 000, ₡33 000 y ₡0: total ₡223 000. Proyección mecánica de 12 meses al mismo ritmo: ₡2 676 000, no pronóstico. Controles: validación de contrato, coincidencias antes de aprobar y recepción/factura contra OC.

## A4. Evaluación de proveedores

Matriz configurable en el sistema: precio 25%, calidad 20%, puntualidad 20%, crédito 10%, posventa 10%, cobertura 5%, riesgo de dependencia 10%. Cada proveedor recibe una nota 1–5 basada en evidencia; el puntaje es Σ(peso×nota)/100. No se inventan calificaciones en el seed. Conviene conservar al menos una fuente alterna para materiales críticos y consolidar volumen solo cuando calidad, capacidad y cobertura lo permitan.

## A5. Stock y reorden

| Material | SS | PR | Actual | Acción |
|---|---:|---:|---:|---|
| Cemento | 45 | 165 | 190 | Normal |
| Varilla | 200 | 800 | 850 | Normal |
| Block | 1 200 | 3 600 | 2 800 | Reponer |
| Arena | 8 | 20 | 14 | Reponer |

Registrar material, cantidad, unidad, tipo, origen/destino, fecha UTC, responsable, motivo, documento, OC/recepción vinculada e idempotency key. La prioridad final requiere considerar criticidad de obra y tiempo de entrega.

## Conclusión

El modelo normalizado evita equivalencias ambiguas; el ledger con FK y transacciones conserva el historial. Alertas y coincidencias son reproducibles y revisables. Importes y proveedores del ejercicio son datos ficticios, no recomendaciones de compra reales.
