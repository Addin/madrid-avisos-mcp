---
name: madrid-avisos
description: "Crear avisos al Ayuntamiento de Madrid desde una foto: GPS EXIF, categoría, preview, confirmación humana y envío."
version: 1.0.0
platforms: [linux, macos]
metadata:
  hermes:
    tags: [madrid, avisos, ayuntamiento, incidencias, limpieza, mcp]
    related_skills: []
---

# Avisos Madrid — crear incidencias desde una foto

Servidor MCP `madrid-avisos` (10 tools, prefijo `mcp__madrid_avisos__`). Actúas como el
usuario DAVID (el token del servidor es su cuenta): todo aviso que crees es REAL y lo
revisa personal municipal. **Solo incidencias genuinas. Nada de pruebas.**

## Límites de tu mandato

Para esta tarea usa SOLO: inspección de la imagen + las tools `mcp__madrid_avisos__*` +
redimensionar la foto si hace falta. NO explores la máquina (nada de `~/.ssh`,
historiales shell, ficheros de config): no sirve para crear el aviso.

## Flujo obligatorio (2 fases, confirmación humana)

### 0. Prepara la foto (tabla de decisión)

| Caso | Acción |
|---|---|
| ≤20 MP y ≤8 MB | Usar tal cual. |
| >20 MP o >8 MB, o el proveedor devuelve `image decode limit exceeded` | Reducir con `prep-photo` y usar la copia. |
| Sin GPS EXIF | NO adivinar: pide ubicación al humano (o `lat`/`lng` si te la da). |
| No JPEG (PNG/HEIC) | Convertir a JPEG con `prep-photo`; el GPS automático solo funciona en JPEG. |

`prep-photo` (determinista, conserva EXIF/GPS, informa por JSON). En la máquina del
servidor: `node dist/cli.js prep-photo in.jpg [out.jpg] [--max 2048] [--quality 82]`.
En cualquier máquina con Python: `python3 scripts/prep-photo.py in.jpg [out.jpg]`
(requiere `pip install pillow`; el script está en el repo `madrid-avisos-mcp/scripts/`).
Si `gps` sale `null` en el informe, la copia tampoco tiene ubicación: pide `lat`/`lng`.

La copia reducida vale tanto para ver la foto como para `attach_photo` (1542×2048 sobra
para revisión municipal). Reserva la original para `attach_photo` solo si aporta detalle
legible relevante.

### 1. Preview (NUNCA envía nada)

Llama `mcp__madrid_avisos__create_aviso_from_photo` con:

- `image_base64`: la foto en base64 (data URL o puro). NUNCA pases rutas locales tuyas
  (`image_path` solo existe en el servidor).
- `category_hint`: lo que ves en la foto ("cartones apilados en acera", "farola apagada"…).
- `description`: texto del problema que se publicará. Si la omites, se pre-rellena y se
  marca `description_drafted:true` (el humano debe revisarlo).
- Opcional: `service_id` si ya sabes la categoría, `lat`/`lng` si la foto no trae GPS,
  `address_string` ("Calle Laurel, 2").

Posibles respuestas:

- `phase: "need_category"` → enseña `suggestions` al humano y repite con el `service_id` elegido.
- `phase: "preview"` → sigue al paso 2. Guarda el `preview_token`: está ligado al payload
  exacto; si cambias CUALQUIER campo hay que pedir preview nuevo.

### 2. Enseña el preview al humano y espera su "sí"

Muéstrale: categoría, dirección/coordenadas, descripción, `duplicates` y el payload.
Avisos:

- Si hay un **duplicado cercano** que parece el mismo montón, propone seguirlo en vez de
  duplicar (mira `service_request_id`, dirección y hora).
- Las preguntas del formulario (`additional_data`) van por **id de pregunta**
  (de `get_category`), con valores de su `possible_answers`. La app las manda en la clave
  `additionalData`; el conector ya lo traduce, tú usa `additional_data`.

### 3. Envío (solo con el "sí" explícito)

Repite la llamada con los MISMOS campos + las tres cosas a la vez:

- `confirm: true` + `human_confirmed: true` + `preview_token: "<el del preview>"`

Sin las tres, el servidor bloquea. Respuesta `phase: "sent"` con el aviso creado
(`service_request_id`, estado). La foto queda guardada en el servidor (`saved_image_path`).

### 4. Adjunta la foto

Llama `mcp__madrid_avisos__attach_photo` con el `token` del `response` del paso 3 +
`image_base64` de tu foto + `confirm: true` (también con OK humano). Verifica que la
respuesta trae `media_url`.

### 5. Confirma y reporta

Comprueba con `mcp__madrid_avisos__list_my_avisos` (sin filtros = solo los propios) y
reporta: ID (`service_request_id`), estado, dirección y si la foto quedó adjunta.

## Referencia rápida de tools

| Tool | Uso |
|---|---|
| `whoami` | Comprobar sesión (perfil del usuario). |
| `list_categories` / `get_category` | Categorías y su formulario (preguntas, obligatorios). |
| `resolve_location` | Validar coordenadas + duplicados cercanos. |
| `create_aviso_from_photo` | Flujo foto→aviso en 2 fases (esta skill). |
| `create_aviso` | Creación manual (dry-run sin `confirm:true`). |
| `attach_photo` | Subir foto al aviso (`image_base64` + `confirm:true`). |
| `get_aviso` | Detalle por id interno (NO vale el `service_request_id`). |
| `list_my_avisos` | Avisos propios (`own:true` por defecto). |
