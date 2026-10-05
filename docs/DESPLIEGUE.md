# Despliegue en Dokploy

Imagen única (`Dockerfile`: bot + Remotion + ffmpeg + Chromium + whisper.cpp) y un servidor local de la
Bot API de Telegram (`docker-compose.yml`). **Mínimo 4 GB de RAM libres** (ideal 8 GB) para renderizar.

> Estado: el `Dockerfile` y el compose están escritos y el compose valida (`docker compose config`), pero **la
> imagen no se pudo construir en el entorno donde se desarrolló** (sin daemon de Docker). El primer build en
> el VPS puede requerir ajustes; ver "Primer despliegue".

## 1. Antes de empezar
- Bot creado con `@BotFather` (`TELEGRAM_BOT_TOKEN`) y tu `chat_id` (`TELEGRAM_ALLOWED_IDS`, con `@userinfobot`).
- `api_id` / `api_hash` de https://my.telegram.org → `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` (servidor local → archivos de hasta 2 GB).
- `OPENROUTER_API_KEY` (con límite de gasto en OpenRouter) — o `MOCK=1` para probar sin gastar.
- Subdominio apuntando al VPS (ej. `bot.tuagencia.com`).
- Carpeta de datos en el VPS (ej. `/srv/agencia`) con `clientes/` y `plantilla/`. Si es nueva: `npm run init-data` o dejá que el bot cree lo que falte.
- (Opcional) `ZERNIO_API_KEY` y las `zernio.cuentas` de cada `cliente.json`.

## 2. Dokploy
1. **Create Service → Compose** → origen **GitHub** (`Koreskill/Telegram-bots`, rama `main`), archivo `docker-compose.yml`.
2. **Environment**: pegá las variables de `.env.example` con valores reales. Importante:
   `NODE_ENV=production`, `TELEGRAM_WEBHOOK_SECRET` y `TELEGRAM_WEBHOOK_PATH` (strings aleatorios de ≥ 16 caracteres, solo `A-Za-z0-9_-`),
   `PUBLIC_URL=https://bot.tuagencia.com`, `DATA_HOST_DIR=/srv/agencia`.
3. **Domains**: `bot.tuagencia.com` → servicio `bot`, puerto `3000`, HTTPS (Let's Encrypt).
4. **Deploy** y esperá a ver `Bot listo (webhook)` en los logs. Activá **Auto Deploy** para desplegar con cada push a `main`.

## 3. Pasar el bot al servidor local (una sola vez)
```bash
# a) cerrar sesión en la API en la nube (obligatorio antes de usar el servidor local)
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/logOut"
# b) desde el contenedor del bot (terminal de Dokploy): registrar el webhook contra el servidor local
npm run set-webhook
```
Después de `logOut`, esperá ~10 min antes de volver a la API en la nube. Probá con `/start` y subí un video grande como archivo.

## 4. Primer despliegue: qué vigilar
- **whisper.cpp**: se compila y baja el modelo (`medium` ≈ 1,5 GB) durante el build (`PREWARM_WHISPER=1`). Si el build es muy lento, usá `--build-arg PREWARM_WHISPER=0`: se hará en el primer `/guion` (varios minutos).
- **Remotion**: usa el Chrome Headless Shell que baja `remotion browser ensure` en el build. Si falla la descarga, definí `REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium`.
- **Permisos** del volumen: el contenedor corre como root; si tu carpeta pertenece a otro usuario, ajustá `user:` en el compose.
- **Licencia de Remotion**: gratuita para individuos y empresas de hasta 3 personas; con más, hace falta licencia de empresa (https://remotion.dev/license).
- **Una sola instancia** por volumen (el bloqueo de `manifest.json` es en proceso).

## 5. Verificación
- `https://bot.tuagencia.com/healthz` → `{"ok":true}`.
- `/start` responde solo a tus IDs. `/nuevocliente Demo` + pegar una URL → proyecto creado.
- Reiniciar el contenedor: el estado (cola, cliente/proyecto activo, manifests) se conserva en el volumen.
