# Bot de Telegram para agencia inmobiliaria

Sistema de agentes controlados por Telegram: capturar la web de la inmobiliaria → descargar imágenes → prompts de extensión → extender a 9:16 → guion y plan de edición → video final con Remotion.

- Plan completo por fases: [`docs/INSTRUCTIVO.md`](docs/INSTRUCTIVO.md)
- Decisiones y desvíos: [`docs/DECISIONES.md`](docs/DECISIONES.md)
- Reglas para Claude Code: [`CLAUDE.md`](CLAUDE.md)

## Estado
| Fase | Estado |
|---|---|
| 0 Carpetas reales | pendiente (requiere acceso a tus carpetas) |
| 1 Cimientos (bot, config, cola, manifest) | ✅ implementada |
| 2–9 Agentes, video, despliegue, Zernio | pendiente |

## Arranque rápido (desarrollo)
```bash
cd bot
npm install
cp ../.env.example .env      # completá TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_IDS, OPENROUTER_API_KEY (o MOCK=1)
# en .env: NODE_ENV=development y DATA_DIR=./data
npm run dev                  # polling; probá /start, /cliente, /proyecto, /estado
npm test
```
`DATA_DIR` debe contener `clientes/` (y más adelante `plantilla/`). El bot solo lee los clientes existentes.
