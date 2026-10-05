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

## Comandos habituales (se completan en la Fase 1)
- `cd bot && npm run dev` — bot en modo polling
- `cd bot && npm test` — tests
- `cd bot && npm run check-models` — valida modelos y precios en OpenRouter
- `cd my-video && npm run dev` — Remotion Studio
