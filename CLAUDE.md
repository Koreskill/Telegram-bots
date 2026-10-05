# CLAUDE.md — Bot de Telegram para agencia inmobiliaria

Proyecto: bot de Telegram con 6 agentes (capturar → imágenes → prompts → extender → guion → video) para una agencia que trabaja con inmobiliarias. Plan completo y por fases en `docs/INSTRUCTIVO.md`. **Léelo antes de escribir código** y trabaja **una fase a la vez**.

## Reglas permanentes
- Idioma: responde y documenta en español (rioplatense neutro). Código y nombres técnicos en inglés o español de forma consistente con lo existente.
- Stack: TypeScript estricto, Node 22, ESM. Telegram con grammY (webhook), cola en SQLite, validación con zod, tests con vitest. Video con Remotion en `my-video/`.
- **Nunca** accedas a rutas de datos fuera de `bot/src/paths.ts`. Sanitiza slugs; bloquea path traversal.
- Las carpetas reales del usuario (`clientes/`, `plantilla/`) son **solo lectura** hasta que el usuario autorice cambios. No renombres ni muevas datos existentes.
- Todo modelo de OpenRouter va en variable de entorno (`MODEL_*`); no hardcodees IDs. Valida con `npm run check-models`.
- Toda salida de un LLM se valida con zod y se reintenta con el error de validación (máx. 2).
- Secretos solo en variables de entorno. Jamás en el repo, logs ni mensajes de Telegram.
- Seguridad: lista blanca de `chat_id`, `secret_token` de webhook, protección anti-SSRF en toda descarga por URL, límites de tamaño y de gasto (`MAX_USD_PER_PROJECT`).
- Las imágenes extendidas con IA conservan los píxeles originales (paste-back) y requieren aprobación manual.
- No publiques en redes (Zernio) sin confirmación explícita del usuario.
- Antes de usar la API de Zernio o un modelo nuevo, lee la documentación vigente; no asumas de memoria.
- En Remotion: lee `my-video/.claude/skills/` antes de tocar la composición; sin CSS transitions ni `Math.random` sin semilla; todo depende de `useCurrentFrame`.
- Flujo: commits pequeños, tests pasando antes de avanzar de fase, desvíos del instructivo anotados en `docs/DECISIONES.md`. Modo `MOCK=1` para no gastar créditos en desarrollo.
- No crees PRs ni hagas push sin que el usuario lo pida.

## Estado
- Implementado: cimientos + agentes 1–9 + skills + triggers + composición Remotion + Docker/CI. Ver `README.md`, `docs/AGENTES.md`, `docs/ESTRUCTURA.md`.
- Pendiente de verificar con credenciales reales: OpenRouter (imagen/voz/JSON estricto), Telegram en vivo, whisper.cpp, Zernio, build de Docker. Ver `docs/DECISIONES.md` §"Qué NO se pudo verificar".
- Fase 0 (carpetas reales del usuario) sigue pendiente: `bot/src/paths.ts` implementa la estructura objetivo.
- Cada agente tiene su skill en `bot/skills/<id>/SKILL.md` (prompts editables sin tocar código).

## Comandos habituales
- `cd bot && cp ../.env.example .env` y completar; luego `npm run dev` — bot en modo polling
- `cd bot && npm test` — tests (vitest) · `npm run typecheck` · `npm run build`
- `cd bot && npm run check-models` — valida modelos y precios en OpenRouter
- `cd bot && npm run set-webhook` — registra el webhook de Telegram (producción)
- `cd bot && npm run init-data` — crea la estructura de clientes/plantilla de ejemplo en DATA_DIR
- `cd my-video && npm run dev` — Remotion Studio · `npm run lint` (eslint + tsc)
