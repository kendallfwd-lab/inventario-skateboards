# Instalación Windows

Requisitos: Node.js 24 LTS o 26 LTS y MySQL 8.4. Docker Desktop es opcional.

## MySQL instalado localmente

1. Con una cuenta administradora MySQL, crea `del_valle_inventory` y el usuario de aplicación (no uses root para el API): `CREATE DATABASE del_valle_inventory CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; CREATE USER 'delvalle_app'@'127.0.0.1' IDENTIFIED BY 'una-clave-larga'; GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON del_valle_inventory.* TO 'delvalle_app'@'127.0.0.1';`.
2. Copia `.env.example` a `.env` y completa `DB_PASSWORD` y las credenciales MySQL.
3. En PowerShell, desde la raíz del proyecto:

```powershell
npm install
npm run db:migrate
npm run db:seed
npm run admin:create
npm run dev
```

`admin:create` solicita nombre, correo y una contraseña nueva de al menos 12 caracteres (entrada oculta). No hay credenciales predeterminadas. Luego inicia sesión como ADMIN y crea perfiles segregados con `POST /api/usuarios` (incluido en Postman); por ejemplo, un usuario COMPRAS para que un ADMIN distinto apruebe la orden. Vite: http://localhost:5173; API: http://localhost:3010.

## Docker Desktop

Copia `.env.example` a `.env`, define `MYSQL_ROOT_PASSWORD` además de `DB_PASSWORD`, luego `docker compose up -d mysql`. Espera healthcheck, ejecuta migrate/seed/admin:create, luego `npm run dev`. Los datos viven en volumen `mysql_data`.

## Gemini opcional

Crea una API key propia en https://aistudio.google.com/app/apikey y colócala solo en `GEMINI_API_KEY` del `.env` del servidor. Reinicia API. `npm run ai:smoke` intenta una llamada real si hay key; sin key, catálogo, compras e inventario siguen disponibles. Nunca uses una key expuesta o de terceros.
