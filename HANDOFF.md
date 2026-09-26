# Traspaso — madrid-avisos-mcp ([github.com/Naroh091/madrid-avisos-mcp](https://github.com/Naroh091/madrid-avisos-mcp))

Documento de handoff para que otro agente/persona continúe. Actualizado: 2026-09-25.

## 1. Objetivo

Exponer como **servidor MCP** la funcionalidad de **avisos** del Ayuntamiento de Madrid
(reportar incidencias urbanas: alumbrado, limpieza, etc.), para que un **agente** (un "Hermes remoto")
pueda listar categorías, resolver ubicaciones, consultar y crear avisos por lenguaje natural.

## 2. De dónde sale todo (contexto)

La API se obtuvo por **ingeniería inversa** de la app Android *Madrid Móvil*
(`es.madrid.SGRSAMVANDCIU`, v03.01.089) y se **verificó con captura de tráfico TLS real**.

- Carpeta de RE / captura: `/Users/david/IdeaProjects/madrid-movil-apk`
  - `API-avisos-madrid.md` — **referencia completa de la API** (endpoints, auth, payload de creación, ejemplos verificados). Léela primero.
  - `jadx-out/` (código decompilado), `apktool-out/` (recursos/manifest), `capture/` (logs mitmproxy + `artifacts/*.json` con respuestas reales).
  - `capture/token.txt` — access token del usuario (ver §6).
- Proyecto MCP: `/Users/david/IdeaProjects/madrid-avisos-mcp` (este repo).

## 3. La API en una cápsula (verificado en vivo)

- **Base**: `https://servpub.madrid.es/AVSICAPI/`
- **Cabeceras**: `X-CLIENT-ID: 54yx…scc`, `X-APP-KEY: 1`, `X-APP-VERSION: 03.01.089`, `Accept-Language: es`, `Authorization: Bearer <token>`.
- **Auth**: `POST login-anonymous` da token (30 días) + refresh; `POST accept_terms` obligatorio tras login. El **login web** (avisos.madrid.es) está tras **Akamai** (no automatizable); pero **la API acepta el bearer token sin Akamai**.
- **Madrid exige usuario registrado** (`only_registered_users: true`) para crear avisos.
- **Crear aviso**: `POST requests` (JSON, rama CityApp: `service_id`, `jurisdiction_id`, `lat`/`long`, `description`, `location_additional_data`, `additional_data`, campos de informante…). Fotos aparte: `POST requests_medias` (multipart, con el `token` del aviso devuelto).
- **Lectura**: `GET services` (categorías), `GET services/{id}`, `GET service/{id}/validate-position`, `GET location-additional-data`, `GET request_duplicate`, `GET requests/{id}`, `POST requests-list`.

## 4. Arquitectura del proyecto

```
src/
  config.ts   # constantes + env (BASE_URL, CLIENT_ID, APP_KEY, TOKEN, REFRESH_TOKEN, TOKEN_STORE…)
  client.ts   # cliente HTTP: cabeceras + bearer, GET/POST/multipart, auto-refresh ante 401
  avisos.ts   # NÚCLEO: funciones de negocio (login, categories, resolveLocation, createAviso…)
  types.ts    # esquemas zod de entrada + tipo del payload de creación
  mcp.ts       # buildServer(): crea el McpServer y registra las 9 tools (compartido)
  server.ts   # entrada STDIO (Claude Desktop/Code local)
  http.ts      # entrada HTTP (Streamable HTTP) para exponer por Tailscale
  cli.ts       # CLI fino para pruebas manuales
```

**10 tools MCP**: `whoami`, `refresh_session`, `list_categories`, `get_category`, `resolve_location`,
`create_aviso` (**dry-run por defecto**; `confirm:true` para enviar de verdad),
`create_aviso_from_photo` (**2 fases**: preview + envío solo con `confirm:true` + `human_confirmed:true` +
`preview_token`; GPS desde EXIF, foto vía base64 o ruta local), `attach_photo`
(dry-run por defecto), `get_aviso`, `list_my_avisos`.

Compilar: `npm install && npm run build`.

## 5. Estado ACTUAL (2026-09-25)

- ✅ Código completo y **compila**; probado en vivo (lectura + dry-run) contra la API real.
- ✅ Token del usuario **sigue válido** (devuelve 82 categorías).
- ✅ stdio y HTTP funcionan (handshake MCP verificado por ambos).
- ⚠️ **Exposición por Tailscale SIN terminar**: ahora mismo el server HTTP **no está corriendo** y
  `tailscale serve` está en **"No serve config"**, así que
  `https://HOST.tailnet.ts.net/mcp` **no responde** (HTTP 000).
- ✅ Dispositivo Android de pruebas **limpio** (proxy quitado, app parcheada desinstalada).
- ✅ Tool `create_aviso_from_photo` (2026-09-25): aviso desde foto en 2 fases con confirmación
  humana obligatoria. Verificado con foto real (GPS EXIF 40.40396,-3.70547 → preview + 3 bloqueos
  de envío + token estable). Detalle en README. Límite body HTTP subido a 32 MB.
- ✅ Skill Hermes `madrid-avisos` (2026-09-26): `hermes-skill/SKILL.md` en el repo + instalada en
  `~/.hermes/skills/madrid-avisos/`. Copiarla al Hermes remoto para que aprenda el flujo foto→aviso.
- ✅ `prep-photo` (2026-09-26): `scripts/prep-photo.py` + `cli.js prep-photo`. Reduce fotos >20 MP
  para el modelo conservando EXIF/GPS e informa por JSON. Tabla de decisión en la skill.
- ✅ Primer envío REAL (2026-09-25, 23:04): aviso 9874607 "Limpieza de calles", Calle Laurel 2,
  con foto adjunta. Bugs del conector encontrados y corregidos esa noche:
  `additional_data`→`additionalData` en el cable (lle.java), `jurisdiction_id` como query en
  `requests_medias` (fg9.java), Content-Type `image/jpeg` en la parte fichero, filtros por defecto
  en `list_my_avisos` (`{jurisdiction_ids,limit,page}` + `own:true` tras ver que sin `own` devolvía
  avisos visibles de la jurisdicción, no solo propios — gu3.java). Secreto aceptado también como Bearer (hermes).

### Cómo dejar la exposición Tailscale funcionando (lo que quedó pendiente)

Hacen falta **dos procesos a la vez**:

1. **Server HTTP** (terminal A, se queda ocupando la terminal):
   ```bash
   cd /Users/david/IdeaProjects/madrid-avisos-mcp
   MADRID_AVISOS_TOKEN=$(cat /Users/david/IdeaProjects/madrid-movil-apk/capture/token.txt) \
   MADRID_AVISOS_MCP_SECRET=<secreto> \
   MADRID_AVISOS_ALLOWED_HOSTS=HOST.tailnet.ts.net \
   npm run start:http     # escucha en 127.0.0.1:3000/mcp
   ```
2. **Tailscale serve** (terminal B, una vez). Usar el CLI de la **app** (versión 1.102.3, coincide con
   el demonio); el de Homebrew (1.82.5) da desajuste de versión y no aplica:
   ```bash
   /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=443 http://127.0.0.1:3000
   /Applications/Tailscale.app/Contents/MacOS/Tailscale serve status   # verificar
   ```
   Requiere **MagicDNS** y **HTTPS Certificates** activados en la consola de Tailscale.

Verificación:
```bash
curl https://HOST.tailnet.ts.net/health        # {"ok":true,...}
```
Conectar el Hermes remoto (mismo tailnet):
```bash
claude mcp add --transport http madrid-avisos \
  https://HOST.tailnet.ts.net/mcp \
  --header "x-mcp-secret: <secreto>"
```

Para que sea persistente, lanzar el server HTTP con `launchd`/`pm2`/`tmux`.
(Hecho 2026-09-26: `~/Library/LaunchAgents/com.madrid-avisos-mcp.http.plist` con KeepAlive
→ `run-http.sh` en el repo; sobrevive cierres de sesión y reinicios. Log en `http.log`.)

## 6. Credenciales y seguridad

- **Token**: en `../madrid-movil-apk/capture/token.txt` (o env `MADRID_AVISOS_TOKEN`). Es el token de
  un usuario registrado real (DAVID). Vive solo en el servidor; quien alcance el MCP actúa como ese usuario.
- **No hay refresh token** disponible (la web no lo expone). Estrategia actual = **opción 1**: cuando
  caduque, re-pegar un access token nuevo de avisos.madrid.es. El auto-refresh está implementado pero
  requiere un `MADRID_AVISOS_REFRESH_TOKEN` que hoy no tenemos (vendría del flujo de la app móvil).
- **Exposición**: usar `tailscale serve` (PRIVADO al tailnet), **nunca `funnel`** (público). Secreto
  opcional `MADRID_AVISOS_MCP_SECRET` (cabecera `x-mcp-secret`) como defensa extra.
- El log de captura tenía las credenciales del login web en claro; **ya fueron redactadas**.

## 7. Pendientes / próximos pasos

1. **Completar la exposición Tailscale** (§5) y dejar el server HTTP persistente.
2. **Primera prueba de envío REAL controlada**: `create_aviso` con `confirm:true` sobre una incidencia
   genuina, para validar el `POST requests` end-to-end (hasta ahora solo dry-run; nunca se ha enviado uno).
3. Refresh token real (opción 2) si se quiere sesión desatendida indefinida.
4. (Opcional) Mapear `additional_data` obligatorios por categoría desde `get_category` para construir
   formularios válidos automáticamente.

## 8. Notas de comportamiento a respetar

- `create_aviso`/`attach_photo` son **dry-run por defecto** a propósito: un envío crea un aviso REAL que
  revisa personal municipal. No enviar avisos de prueba/no genuinos.
- No intentar sortear Akamai en el login (es anti-fraude de una administración pública).
