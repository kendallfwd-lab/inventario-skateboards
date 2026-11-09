# Arquitectura

React + TypeScript + Vite sirve la interfaz en 5173. Express 5 + TypeScript ofrece REST en 3010. MySQL 8.4/InnoDB persiste catálogos, aprobaciones, políticas, ledger, compras, sesiones, auditoría y asistente. `stock.ts` realiza movimientos en transacción; el servidor calcula indicadores y valida permisos. Gemini recibe solamente una pregunta y un contexto de lectura preparado por el servidor mediante el SDK `@google/genai` Interactions API, `store:false`, sin herramientas, timeout de 20 s y un reintento acotado.

Sesiones: token aleatorio de 256 bits; el navegador solo recibe cookie HttpOnly/SameSite Strict; MySQL almacena SHA-256 del token y caducidad. Contraseñas bcrypt cost 12. Los cambios requieren sesión y roles autorizados.
