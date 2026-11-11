# Estado de verificación

Fecha de referencia: 9 de noviembre de 2026.

## Comprobado en la ejecución de referencia

- `npm run typecheck`, `npm run build`, `npm run lint` y `npm run test` pasaron.
- Las seis pruebas originales cubrieron políticas de reorden, alertas, sobreprecio de ₡223 000, duplicados candidatos y autenticación sin sesión.
- Vite sirvió la página inicial con HTTP 200 en `http://127.0.0.1:5173` y la API inició en el puerto 3010.
- `npm run ai:smoke` informó `SKIP` sin `GEMINI_API_KEY`, comportamiento esperado.
- Se añadieron pruebas de regresión para aceptar el origen de Vite en loopback (`127.0.0.1:5173`) y rechazar mutaciones desde orígenes externos.

## Bloqueos del entorno actual

- Docker está instalado, pero el daemon no está iniciado; MySQL tampoco está en PATH. No se ejecutaron migraciones ni semillas, ni se comprobaron persistencia, concurrencia InnoDB, autenticación contra MySQL o el ciclo completo de compras y recepción.
- `npm install` no pudo completar porque el caché global de npm devolvió errores de permisos y una descarga bloqueada. Reintentar con permisos de usuario adecuados o un caché local limpio.
- `npm run test:e2e` requiere Chromium. Los casos desktop y móvil quedan pendientes hasta instalar el navegador con `npx playwright install chromium`.
- Gemini queda pendiente de una clave y cuota propias del usuario. Sin clave, el resto de la aplicación continúa funcionando.
