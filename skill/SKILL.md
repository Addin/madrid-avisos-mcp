---
name: madrid-avisos
description: "Crea avisos al Ayto. de Madrid desde una foto"
version: 1.1.0
platforms: [linux, macos]
metadata:
  hermes:
    tags: [madrid, avisos, ayuntamiento, incidencias, limpieza, mcp]
    category: civic
---

# Avisos Madrid — incidencias desde una foto

Servidor MCP `madrid-avisos` (10 tools, prefijo `mcp__madrid_avisos__`). Actúas como el
dueño del token configurado en el servidor: todo aviso que crees es REAL y lo
revisa personal municipal. **Solo incidencias genuinas. Nada de pruebas.**

## When to Use

Cuando el humano te pasa una foto de una incidencia urbana en Madrid (basura, farolas,
aceras…) y te pide generar un aviso al Ayuntamiento. Para esta tarea usa SOLO:
inspección de la imagen + las tools `mcp__madrid_avisos__*` + redimensionar la foto si
hace falta. NO explores la máquina (nada de `~/.ssh`, historiales shell, ficheros de
config): no sirve para crear el aviso.

## Procedure

### 0. Prepara la foto

| Caso | Acción |
|---|---|
| ≤20 MP y ≤8 MB | Usar tal cual. |
| >20 MP o >8 MB, o el proveedor devuelve `image decode limit exceeded` | Reducir con `prep-photo` y usar la copia. |
| Sin GPS EXIF | NO adivinar: pide ubicación al humano (o `lat`/`lng` si te la da). |
| No JPEG (PNG/HEIC) | Convertir a JPEG con `prep-photo`; el GPS automático solo funciona en JPEG. |

`prep-photo` es determinista, conserva EXIF/GPS, no exige dependencias e informa por
JSON. En la máquina del servidor: `node dist/cli.js prep-photo in.jpg [out.jpg]
[--max 2048] [--quality 82]`. En cualquier máquina: `python3 scripts/prep-photo.py
in.jpg [out.jpg]` (el script está en el repo `madrid-avisos-mcp/scripts/`).
Si `gps` sale `null` en el informe, pide `lat`/`lng` al humano.

La copia reducida vale tanto para ver la foto como para `attach_photo`. Reserva la
original para `attach_photo` solo si aporta detalle legible relevante.

### 1. Preview (NUNCA envía nada)

Llama `mcp__madrid_avisos__create_aviso_from_photo` con:

- `image_base64`: la foto en base64 (data URL o puro). NUNCA pases rutas locales tuyas
  (`image_path` solo existe en el servidor).
- `category_hint`: lo que ves en la foto ("cartones apilados en acera", "farola apagada"…).
- `description`: descripción GENERAL de lo que sucede, sin entrar en detalles (medidas,
  marcas, minucias). Es el texto que se publicará. Si la omites, se pre-rellena y se
  marca `description_drafted:true` (el humano debe revisarlo).
- Opcional: `service_id` si ya sabes la categoría, `lat`/`lng` si la foto no trae GPS,
  `address_string` ("Calle Laurel, 2").

Posibles respuestas:

- `phase: "need_category"` → enseña `suggestions` al humano y repite con el `service_id` elegido.
- `phase: "preview"` → sigue al paso 2. Guarda el `preview_token`: está ligado al payload
  exacto; si cambias CUALQUIER campo hay que pedir preview nuevo.

### 2. Enseña el preview al humano y espera su "sí"

Muéstrale: categoría, dirección/coordenadas, descripción, `duplicates` y el payload.

- Si hay un **duplicado cercano** que parece el mismo montón, propone seguirlo en vez de
  duplicar (mira `service_request_id`, dirección y hora).
- Las preguntas del formulario (`additional_data`) van por **id de pregunta**
  (de `get_category`), con valores de su `possible_answers`.

### 3. Envío (solo con el "sí" explícito)

Repite la llamada con los MISMOS campos + las tres cosas a la vez:

- `confirm: true` + `human_confirmed: true` + `preview_token: "<el del preview>"`

Sin las tres, el servidor bloquea. Respuesta `phase: "sent"` con el aviso creado
(`service_request_id`, estado).

### 4. Adjunta la foto y reporta

Llama `mcp__madrid_avisos__attach_photo` con el `token` del `response` del paso 3 +
`image_base64` de tu foto + `confirm: true` (también con OK humano). Comprueba con
`mcp__madrid_avisos__list_my_avisos` y reporta: ID (`service_request_id`), estado,
dirección y si la foto quedó adjunta (`media_url`).

## Pitfalls

- Pasar `image_path` con una ruta de tu máquina: el servidor no la ve. Siempre `image_base64`.
- Enviar `additional_data` con el **código** de pregunta en vez del **id**: el servidor lo
  rechaza. El id sale de `get_category`.
- Cambiar cualquier campo entre preview y envío: el `preview_token` deja de coincidir y
  hay que repetir el preview.
- `get_aviso` NO acepta el `service_request_id` visible; necesita el id interno.
- Perder el EXIF al redimensionar (p.ej. captura de pantalla de la foto): sin GPS no hay
  aviso automático; pide ubicación.

## Verification

- `mcp__madrid_avisos__whoami` devuelve el perfil (sesión válida).
- Tras el envío, `mcp__madrid_avisos__list_my_avisos` muestra el aviso con su
  `service_request_id` y `media_url` con la foto.
