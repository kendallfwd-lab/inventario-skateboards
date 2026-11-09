# Reglas de negocio

- Libro de stock append-only. Entrada suma destino; salida resta origen; traslado resta origen y suma destino en una sola transacción. Nunca saldo negativo. Idempotencia mediante clave única.
- SS = (demanda máxima − demanda promedio) × lead time. PR = demanda promedio × lead time + SS. Datos de quiz: cemento SS 45 / PR 165; varilla 200 / 800; block 1200 / 3600; arena 8 / 20. Alertas iniciales solo para block y arena.
- Duplicado: mismo proveedor/material, cantidad con tolerancia ±5%, fechas a tres días o menos. Es una sugerencia para revisión, no anulación automática.
- Sobreprecio se calcula por línea frente a contrato comparable. En los datos suministrados suma ₡223 000. La sospecha de duplicidad se reporta por separado.
- Reposición y aprobación son reglas determinísticas; IA no puede crear movimientos ni aprobar órdenes.
