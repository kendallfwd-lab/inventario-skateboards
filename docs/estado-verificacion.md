# Estado de verificación

Fecha de referencia: 10 de noviembre de 2026.

## Comprobado en esta ejecución

- Node.js `v24.19.0` y npm `11.17.0`.
- `npm run typecheck`, `npm run lint`, `npm test` (18 pruebas) y `npm run build` pasaron con CRM, cobros y promociones. El build conserva la advertencia de Vite por un bundle mayor a 500 kB.
- Las migraciones `003_crm_customer_payments.sql` y `004_store_promotions.sql` se aplicaron; repetir `npm run db:migrate` no volvió a ejecutar cambios ya registrados. Los conteos de clientes, ventas y pedidos existentes se mantuvieron en 30, 180 y 0.
- `GET /api/health` devolvió HTTP 200 con MySQL conectado.
- `npm run test:e2e` pasó 16 casos: 8 flujos en escritorio y móvil, incluida la navegación vertical con rueda incluso sobre la galería, los descuentos válidos e inválidos y la recuperación del catálogo tras una falla temporal del API. El catálogo y las respuestas del checkout se simulan en E2E, sin escribir en la base de datos. Playwright quedó limitado a un worker para evitar tiempos de cierre de Chromium en este entorno.
- La galería de inicio usa tarjetas estáticas con desplazamiento horizontal nativo; la compilación frontend pasó y el JavaScript principal quedó en 315 kB (antes 590 kB).
- El endpoint público de validación respondió 422 a un código inexistente (sin insertar pedido); `/api/promotions` respondió 401 sin sesión. No se crearon promociones, pedidos, clientes ni cobros de prueba.
- La interfaz muestra el registro/historial de cobros solo a los roles `ADMIN` y `FINANZAS`, y limita CRM/promociones a los roles autorizados por sus rutas.
- La interfaz respondió HTTP 200 en el puerto alternativo de Vite. El puerto puede variar si los puertos de desarrollo predeterminados están ocupados.

## Pendiente

- No se probaron concurrencia ni rollback con pedidos transaccionales aislados; el flujo de aplicar un código válido y registrar una redención requiere una cuenta administradora y una promoción real.
- Falta completar la prueba autenticada con cuentas de cada rol y la redención válida con una campaña real.
- Gemini requiere una clave y cuota propias del usuario. Sin clave, el resto de la aplicación continúa funcionando.
- Vite mantiene una advertencia de bundle JavaScript mayor a 500 kB; el build finaliza correctamente.
