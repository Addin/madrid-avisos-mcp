# madrid-avisos-mcp

Servidor **MCP** (y CLI de apoyo) para la API de Avisos del Ayuntamiento de Madrid
(`AVSICAPI`, `https://servpub.madrid.es/AVSICAPI/`). Permite a un agente listar categorías,
resolver una ubicación, consultar avisos y crear avisos (con dry-run por defecto).

> API descubierta por ingeniería inversa de la app *Madrid Móvil* y verificada con captura
> de tráfico real. Ver `../madrid-movil-apk/API-avisos-madrid.md` para el detalle de la API.

## Arquitectura

- `src/client.ts` — cliente HTTP: cabeceras de app + bearer token, GET/POST/multipart.
- `src/avisos.ts` — **núcleo** con la lógica de negocio (reutilizado por MCP y CLI).
- `src/types.ts` — esquemas zod de entrada y tipo del payload de creación.
- `src/server.ts` — servidor MCP (stdio) que expone las tools.
- `src/cli.ts` — CLI fino para pruebas manuales.

## Instalación

```bash
npm install
npm run build
```

## Inicio rápido (cada ciudadano en su local)

1. Inicia sesión en <https://avisos.madrid.es> con tu usuario.
2. Abre las DevTools del navegador (F12) → pestaña **Network**, recarga y pulsa cualquier
   petición a `servpub.madrid.es/AVSICAPI`: copia el valor de la cabecera `Authorization`
   (empieza por `Bearer eyJ…`). Ese es tu `MADRID_AVISOS_TOKEN` (caduca; repite el paso
   cuando deje de funcionar).
3. Configura tu cliente MCP (Claude Desktop / Claude Code) apuntando al servidor local:

```json
{
  "mcpServers": {
    "madrid-avisos": {
      "command": "node",
      "args": ["/ruta/a/madrid-avisos-mcp/dist/server.js"],
      "env": { "MADRID_AVISOS_TOKEN": "<tu-token>" }
    }
  }
}
```

4. Flujo: `list_categories` → `resolve_location` → `create_aviso` (dry-run) → enseña el
   preview al humano → `confirm: true` solo con su "sí" → `attach_photo` para la foto.

Todo corre en tu máquina y el token no sale de ella: cada aviso se crea como tu usuario.

## Configuración

Variables de entorno (ver `.env.example`):

- `MADRID_AVISOS_TOKEN` — **bearer token de un usuario registrado**. Necesario para
  crear/listar/consultar avisos (Madrid tiene `only_registered_users: true`).
  Se obtiene iniciando sesión en <https://avisos.madrid.es> y copiando el token del
  almacenamiento del navegador. El login está protegido por Akamai, por eso no se automatiza
  aquí; la API en sí acepta el token sin problema.
- `MADRID_AVISOS_REFRESH_TOKEN` — refresh token (del mismo almacenamiento del navegador). Si se
  define, el cliente **refresca el access token automáticamente ante un 401** (`POST oauth/v2/token`)
  y reintenta la petición. También hay una tool `refresh_session` para forzarlo.
- `MADRID_AVISOS_TOKEN_STORE` — ruta a un JSON opcional. Si se define, los tokens se cargan de ahí
  al arrancar y se **persisten al refrescar** (el refresh token puede rotar, así que conviene).
- Opcionales: `MADRID_AVISOS_BASE_URL`, `MADRID_AVISOS_JURISDICTION`, `MADRID_AVISOS_LANGUAGE`.

### Caducidad y refresco

El access token caduca (el login anónimo daba `expires_in` de 30 días; el token web puede diferir).
Con `MADRID_AVISOS_REFRESH_TOKEN` configurado no hay que hacer nada: ante un 401 el cliente refresca
solo y reintenta. Si usas `MADRID_AVISOS_TOKEN_STORE`, los tokens rotados quedan guardados entre
reinicios. El refresco replica el flujo de la app: `POST oauth/v2/token` con
`{ grant_type: "refresh_token", refresh_token, client_id }` y sin cabecera `Authorization`.

## Herramientas MCP

| Tool | Qué hace |
|---|---|
| `whoami` | Perfil del usuario autenticado (valida el token). |
| `list_categories` | Categorías/servicios de la jurisdicción (id, flags de formulario). |
| `get_category` | Detalle de una categoría (formulario, obligatorios, tipología). |
| `resolve_location` | Valida posición + dirección/preguntas de ubicación + duplicados. |
| `create_aviso` | Crea un aviso. **Dry-run por defecto**; `confirm: true` para enviar de verdad. |
| `create_aviso_from_photo` | Aviso desde foto en 2 fases: preview (GPS EXIF + categoría + ubicación) y envío solo con `confirm:true` + `human_confirmed:true` + `preview_token`. |
| `attach_photo` | Adjunta una foto a un aviso creado. Acepta `image_base64` (Hermes remoto) o `image_path` local. Dry-run por defecto. |
| `get_aviso` | Detalle de un aviso por id. |
| `list_my_avisos` | Lista los avisos del usuario. |

### Seguridad de `create_aviso` / `create_aviso_from_photo`

`create_aviso` es **dry-run por defecto**: devuelve el payload que se enviaría **sin crear nada**.
Solo con `confirm: true` realiza el `POST` real, que **crea un aviso real** en el sistema del
Ayuntamiento (lo revisa personal municipal). Envía únicamente incidencias reales.

`create_aviso_from_photo` va un paso más allá (confirmación humana obligatoria en dos fases):
1. **Preview** (`confirm` ausente/false): extrae el GPS EXIF de la foto (o usa `lat`/`lng`
   manuales si no hay), sugiere categoría a partir de `category_hint` si falta `service_id`,
   resuelve ubicación (validación + duplicados) y devuelve el payload + un `preview_token`.
   No envía nada. La foto queda guardada en el servidor (`saved_image_path`) para `attach_photo`.
2. **Envío**: el agente muestra el preview al humano y espera su "sí"; solo entonces repite
   la llamada con los MISMOS campos + `confirm: true` + `human_confirmed: true` + `preview_token`.
   Si cambió cualquier campo, el token no coincide y hay que repetir el preview.

La foto puede llegar como `image_base64` (el Hermes remoto) o `image_path` local (stdio/CLI).
Solo JPEG trae EXIF legible; el límite del body HTTP es de 32 MB.

## Uso como MCP (Claude Desktop / Claude Code)

Ya cubierto en el [Inicio rápido](#inicio-rápido-cada-ciudadano-en-su-local). Con `MADRID_AVISOS_REFRESH_TOKEN`
y `MADRID_AVISOS_TOKEN_STORE` (ver `.env.example`) el refresco es automático.

## Despliegue por HTTP + Tailscale (opcional, avanzado)

Si quieres que un agente remoto use TU copia (él actuará como tu usuario), el servidor
tiene una entrada **HTTP** además de la stdio. Para uso personal normal no la necesitas.

### 1. Arranca el servidor HTTP (en la máquina que tiene el token)

```bash
export MADRID_AVISOS_TOKEN=<tu-token>
export MADRID_AVISOS_MCP_SECRET=<un-secreto-largo>          # defensa extra (cabecera x-mcp-secret)
export MADRID_AVISOS_ALLOWED_HOSTS=tu-host.tu-tailnet.ts.net  # anti DNS-rebinding
npm run start:http     # escucha en 127.0.0.1:3000/mcp
```

Solo escucha en `127.0.0.1` (a donde proxya Tailscale); no se abre a la LAN. Variables:
`MADRID_AVISOS_HTTP_PORT` (3000), `MADRID_AVISOS_HTTP_HOST` (127.0.0.1), `MADRID_AVISOS_HTTP_PATH` (/mcp).

Para que sea persistente, lánzalo con `pm2`, `launchd`, `tmux` o similar.

### 2. Expón el puerto por Tailscale (privado al tailnet)

```bash
tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve status     # comprobar
```

Requiere tener activados **MagicDNS** y **HTTPS Certificates** en la consola de administración de
Tailscale. La URL del MCP queda:

```
https://tu-host.tu-tailnet.ts.net/mcp
```

Prueba de humo (sonda de salud, sin secreto):
`curl https://tu-host.tu-tailnet.ts.net/health`

### 3. Conecta el Hermes remoto

Ese Hermes (dentro del mismo tailnet) apunta a la URL como servidor MCP HTTP, añadiendo la cabecera
del secreto. Ejemplo con Claude Code:

```bash
claude mcp add --transport http madrid-avisos \
  https://tu-host.tu-tailnet.ts.net/mcp \
  --header "x-mcp-secret: <un-secreto-largo>"
```

O en la config de un cliente MCP genérico:

```json
{
  "mcpServers": {
    "madrid-avisos": {
      "transport": "http",
      "url": "https://tu-host.tu-tailnet.ts.net/mcp",
      "headers": { "x-mcp-secret": "<un-secreto-largo>" }
    }
  }
}
```

> Seguridad: el token de Madrid vive solo en el servidor; cualquiera que llegue a la URL actúa como
> ese usuario. El acceso lo restringe Tailscale (ACLs del tailnet) y, opcionalmente, el secreto
> compartido. Usa `serve` (privado), nunca `funnel` (público).

## Uso como CLI (pruebas)

```bash
export MADRID_AVISOS_TOKEN=<tu-token>
node dist/cli.js categories
node dist/cli.js category 591b39e24e4ea83a018b46ad
node dist/cli.js resolve 591b39e24e4ea83a018b46ad 40.4168 -3.7038
node dist/cli.js create 591b39e24e4ea83a018b46ad 40.4168 -3.7038 "Farola apagada"   # dry-run
node dist/cli.js create 591b39e24e4ea83a018b46ad 40.4168 -3.7038 "Farola apagada" --send  # ENVÍA de verdad
node dist/cli.js aviso <id>
node dist/cli.js prep-photo foto.jpg [foto-hermes.jpg]   # reduce para el modelo, conserva EXIF/GPS
```

## Flujo típico del agente

1. `list_categories` → elegir `service_id`.
2. (opcional) `get_category` → ver campos obligatorios y preguntas.
3. `resolve_location` → validar coordenadas y obtener `location_additional_data`.
4. `create_aviso` en dry-run → revisar el payload.
5. `create_aviso` con `confirm: true` → crear el aviso.
6. `attach_photo` con el `token` devuelto → subir fotos.
7. `get_aviso` → seguimiento.

## Notas / pendientes

- **Refresco de token: implementado** (auto ante 401 + tool `refresh_session`). Requiere aportar el
  `MADRID_AVISOS_REFRESH_TOKEN`. Pendiente de probar end-to-end con un refresh token real.
- Algunas categorías/jurisdicciones exigen **usuario registrado**; con `login-anonymous` no se podrán
  enviar (Madrid lo exige a nivel de jurisdicción).
- El payload de `create_aviso` está construido según el serializador de la app y contrastado con el
  formulario real, pero **no se ha ejecutado un envío real**; conviene una primera prueba controlada.
