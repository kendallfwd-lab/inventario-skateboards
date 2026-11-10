# Del Valle Inventory AI

## Tienda Skateboards

La raíz pública ahora es una tienda de tablas en español: exhibidor interactivo, catálogo, filtros, detalle de producto, carrito persistente y solicitud de pedido. El área privada se encuentra en `/admin/login` y conserva la autenticación por cookie HttpOnly. Los pedidos aceptados por administración generan salidas de inventario desde la misma fuente de movimientos; cancelar un pedido aceptado registra una reposición idempotente.

La migración `database/migrations/001_skate_store.sql` añade productos comerciales, variantes vinculadas a materiales inventariables, pedidos de clientes y líneas históricas de precio. Las semillas de tienda cargan veintiocho diseños ficticios de deck con stock inicial idempotente, sin modificar ni renombrar el histórico de construcción.

Aplicación local para compras e inventario de Constructora Del Valle S.A. (datos académicos ficticios). Interfaz React/TypeScript, API Node/Express/TypeScript, MySQL 8.4/InnoDB y Gemini opcional de solo lectura.

## Lo que incluye

- Panel de control con KPIs consultados en MySQL, actividad, cobertura y señales de stock.
- Catálogo normalizado, alias, proveedores y relaciones N:M.
- Libro append-only de existencias; entradas, salidas, traslados, idempotencia, control de stock insuficiente, bloqueo por material y ubicación, alertas automáticas y trazabilidad de recepciones.
- Requisiciones, cotizaciones, órdenes, aprobación/rechazo independiente, recepción parcial/completa, facturas con validación three-way match y pagos registrados sin integrar movimientos bancarios reales.
- Matriz de proveedores configurable por 7 criterios (pesos semilla suman 100%) y evaluaciones ponderadas sin calificaciones ficticias.
- Detección explicable de sospecha de duplicados sin cancelar documentos.
- Cálculo de fuga frente al contrato: ₡223 000 con los datos entregados.
- Sesión en cookie HttpOnly, roles, bcrypt, límites de solicitudes y validación Zod.
- Copiloto Gemini backend opcional; no utiliza SQL arbitrario ni herramientas de escritura.
- Diseño responsive en español; guía de demo e informe académico.

## Inicio rápido en Windows

Instala Node.js 24/26 LTS y MySQL 8.4. Sigue [instalacion-windows.md](docs/instalacion-windows.md). En resumen, crea antes la base y el usuario de aplicación en MySQL; copia `.env.example` a `.env` y define credenciales locales. Luego:

```powershell
npm install
npm run db:migrate
npm run db:seed
npm run admin:create
npm run dev
```

`admin:create` requiere terminal interactiva; solicita nombre/correo y una contraseña de mínimo 12 caracteres que no se muestra. No existe cuenta o clave predeterminada.

- Web: http://localhost:5173
- API: http://localhost:3010/api
- Estado DB: http://localhost:3010/api/health (MySQL debe estar disponible)

Docker Desktop: copia `.env.example` a `.env`, cambia `DB_PASSWORD` y `MYSQL_ROOT_PASSWORD`, y ejecuta `docker compose up --build`. La app web queda en http://localhost:8080 y MySQL conserva datos en volumen. El primer administrador se crea de forma interactiva desde el contenedor con `docker compose exec backend node backend/dist/db/create-admin.js`.

## Gemini (opcional)

Obtén tu propia clave en https://aistudio.google.com/app/apikey y guárdala solo en `GEMINI_API_KEY` en `.env` del servidor. El frontend nunca recibe la clave. `npm run ai:smoke` comprueba una petición real cuando existe key/cuota; si no, informa SKIP. No se provee key de ejemplo real.

## Comandos de proyecto

```sh
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
```

## Documentación

- [DER 3FN y relaciones N:M](docs/DER.md)
- [Arquitectura](docs/arquitectura.md)
- [Reglas de negocio](docs/reglas-negocio.md)
- [Seguridad](docs/seguridad.md)
- [OpenAPI](docs/api-openapi.yaml)
- [Colección Postman](docs/postman_collection.json)
- [Consultas de verificación](docs/verificacion-sql.sql)
- [Demo 5 minutos](docs/demo-5-minutos.md)
- [Presentación 10 minutos](docs/presentacion-10-minutos.md)
- [Informe académico](docs/informe-academico.md)
- [Decisiones y fuentes](docs/decisiones-tecnicas.md)

## Limitaciones del entorno de construcción

Este workspace no tiene un servidor MySQL ni Docker instalado. El código, esquema y semillas están preparados para MySQL 8.4, pero la ejecución de migraciones, persistencia, auth contra DB, pruebas de integración con MySQL y URLs locales API no se consideran comprobadas hasta correrlo sobre un servicio MySQL. No se despliega ni publica.
