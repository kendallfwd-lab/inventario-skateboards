# Decisiones técnicas

Fecha de comprobación: 9 de noviembre de 2026.

- Node.js 24 LTS está instalado en el entorno (v24.22.1); la tabla oficial marca v24 en LTS el 27-10-2026. https://nodejs.org/en/about/previous-releases
- MySQL 8.4 LTS se usa en InnoDB; se verificó la guía oficial sobre transacciones y lecturas bloqueantes. Los movimientos bloquean políticas de stock por material/ubicación dentro de la transacción y usan ledger append-only. https://dev.mysql.com/doc/refman/8.4/en/
- Gemini: SDK oficial `@google/genai` 3.x, Interactions API y modelo `gemini-3.8-flash` estable según documentación vigente; https://ai.google.dev/gemini-api/docs/interactions-overview y https://ai.google.dev/gemini-api/docs/models
- La referencia Skate Deck Rail es un componente de galería/hero con licencia MIT. Este producto es un panel de operaciones, por lo que se reutiliza como guía de jerarquía visual y presentación, no como catálogo de skate. https://docs.21st.dev/@dhxwhy/components/skate-deck-rail
- El cliente Gemini se instancia exclusivamente en backend; no hay variable VITE para la API key ni herramientas de escritura para el modelo.

Versiones comprobadas al construir: Node v24.22.1, npm 11.9.0, `@google/genai` 3.0.0 disponible en npm. Versiones de dependencias fijadas en package-lock al ejecutar npm install.
