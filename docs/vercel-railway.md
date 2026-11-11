# Publicar el catálogo en Vercel

El frontend conserva las llamadas `/api/...`. Cuando se ejecuta en Vercel, la función `frontend/api/[...path].js` actúa como proxy hacia el backend Express; así las cookies de administración permanecen en el mismo dominio de la web.

## Vercel

Configura el proyecto con estos valores:

- Root Directory: `frontend`
- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Variable de entorno: `BACKEND_URL=https://TU-BACKEND.up.railway.app`

No coloques una barra final en `BACKEND_URL`. La segunda regla de `frontend/vercel.json` permite abrir directamente rutas SPA como `/admin/login`.

## Railway

Usa un servicio MySQL y otro servicio para el backend conectado al repositorio. En el servicio backend selecciona como Dockerfile `backend/Dockerfile` y conserva como contexto la raíz del repositorio, porque la imagen necesita `database/`.

Variables mínimas del backend:

```text
NODE_ENV=production
FRONTEND_URL=https://inventario-skateboards-web.vercel.app
DB_HOST=<host MySQL de Railway>
DB_PORT=<puerto MySQL de Railway>
DB_NAME=<base MySQL>
DB_USER=<usuario MySQL>
DB_PASSWORD=<contraseña MySQL>
```

Después de que MySQL esté disponible, ejecuta las migraciones y semillas desde un entorno con acceso a esa base:

```text
npm run db:migrate
npm run db:seed
```

Comprueba primero `https://TU-BACKEND.up.railway.app/api/health`; debe responder `status: "ok"` y `database: "connected"`. Luego verifica el mismo endpoint desde `https://inventario-skateboards-web.vercel.app/api/health` y finalmente el catálogo.

`BACKEND_URL` solo debe contener el dominio HTTPS del backend; nunca uses `localhost` o `127.0.0.1` en Vercel.
