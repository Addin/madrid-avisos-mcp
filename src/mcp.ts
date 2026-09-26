/**
 * Construcción del servidor MCP y registro de tools.
 * Compartido por la entrada stdio (server.ts) y la HTTP (http.ts).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AvisosClient, AvisosApiError } from "./client.js";
import { DEFAULT_JURISDICTION } from "./config.js";
import {
  attachPhoto,
  createAviso,
  createAvisoFromPhoto,
  getAviso,
  getCategory,
  getProfile,
  listCategories,
  listMyAvisos,
  refreshSession,
  resolveAddress,
  resolveLocation,
} from "./avisos.js";
import { CreateAvisoFromPhotoInput, CreateAvisoInput } from "./types.js";

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
async function run<T>(fn: () => Promise<T>) {
  try {
    return json(await fn());
  } catch (e) {
    if (e instanceof AvisosApiError) return fail(`Error ${e.status}: ${JSON.stringify(e.body)}`);
    return fail(String(e));
  }
}

/**
 * Crea una instancia del servidor MCP con todas las tools registradas.
 * Se puede pasar un cliente propio (útil por sesión HTTP); por defecto usa el global (env).
 */
export function buildServer(client: AvisosClient = new AvisosClient()): McpServer {
  const server = new McpServer({ name: "madrid-avisos", version: "0.1.0" });

  server.tool(
    "whoami",
    "Devuelve el perfil del usuario autenticado (requiere token). Útil para comprobar que el token es válido.",
    {},
    () => run(() => getProfile(client)),
  );

  server.tool(
    "refresh_session",
    "Refresca el access token usando el refresh token (requiere MADRID_AVISOS_REFRESH_TOKEN). También ocurre automáticamente ante un 401.",
    {},
    () => run(() => refreshSession(client)),
  );

  server.tool(
    "list_categories",
    "Lista las categorías/servicios de avisos de una jurisdicción (por defecto es.madrid). Cada categoría trae su id (service_id), flags de formulario y si requiere fotos/descripción.",
    { jurisdiction_id: z.string().optional().describe("por defecto es.madrid") },
    ({ jurisdiction_id }) => run(() => listCategories(client, jurisdiction_id ?? DEFAULT_JURISDICTION)),
  );

  server.tool(
    "get_category",
    "Detalle de una categoría/servicio: definición del formulario, campos obligatorios, tipología y preguntas.",
    { service_id: z.string(), jurisdiction_id: z.string().optional() },
    ({ service_id, jurisdiction_id }) =>
      run(() => getCategory(client, service_id, jurisdiction_id ?? DEFAULT_JURISDICTION)),
  );

  server.tool(
    "resolve_location",
    "Para una categoría y unas coordenadas: valida que la posición cae en zona del servicio (validate-position), obtiene la dirección municipal + preguntas de ubicación (location-additional-data) y comprueba duplicados cercanos. Sin jurisdiction_element_id usa la ciudad de Madrid.",
    { service_id: z.string(), lat: z.number(), lng: z.number(), jurisdiction_element_id: z.string().optional() },
    ({ service_id, lat, lng, jurisdiction_element_id }) =>
      run(() => resolveLocation(client, service_id, lat, lng, jurisdiction_element_id)),
  );

  server.tool(
    "resolve_address",
    "Geocodificación inversa propia: coords -> dirección municipal (formatted_address) + respuestas pre-rellenadas de ubicación (tipo_via, barrio, distrito…). Sin jurisdiction_element_id usa la ciudad de Madrid.",
    { lat: z.number(), lng: z.number(), jurisdiction_element_id: z.string().optional() },
    ({ lat, lng, jurisdiction_element_id }) => run(() => resolveAddress(client, lat, lng, jurisdiction_element_id)),
  );

  server.tool(
    "create_aviso",
    "Crea un aviso. IMPORTANTE: por defecto es DRY-RUN (confirm=false) y solo devuelve el payload que se enviaría, SIN crear nada. Para crear un aviso REAL en el Ayuntamiento de Madrid hay que pasar confirm=true. Madrid exige usuario registrado (token válido).",
    CreateAvisoInput.shape,
    (input) => run(() => createAviso(client, input as CreateAvisoInput)),
  );

  server.tool(
    "create_aviso_from_photo",
    "Crea un aviso a partir de una FOTO en dos fases. VÍA PREFERIDA: sube la foto con PUT /upload (curl, sin que el modelo la procese) y pasa file_id; el servidor la reduce y devuelve preview_image_base64 para visión. Por stdio usa image_path local. Fase 1 (confirm=false): preview + preview_token SIN enviar. Fase 2: MISMOS campos + confirm:true + human_confirmed:true + preview_token (tras 'sí' humano). Sin las tres NO se envía.",
    CreateAvisoFromPhotoInput.shape,
    (input) => run(() => createAvisoFromPhoto(client, input as CreateAvisoFromPhotoInput)),
  );

  server.tool(
    "attach_photo",
    "Adjunta una foto a un aviso ya creado, usando su request_token. Foto por file_id (PUT /upload), image_path local o image_base64. Dry-run por defecto; confirm=true para subirla.",
    { request_token: z.string(), image_path: z.string().optional().describe("ruta local al servidor"), image_base64: z.string().optional().describe("foto en base64 (data URL o puro)"), file_id: z.string().optional().describe("id de PUT /upload"), confirm: z.boolean().optional(), jurisdiction_id: z.string().optional().describe("por defecto es.madrid") },
    ({ request_token, image_path, image_base64, file_id, confirm, jurisdiction_id }) =>
      run(() => attachPhoto(client, request_token, { image_path, image_base64, file_id }, confirm ?? false, jurisdiction_id)),
  );

  server.tool("get_aviso", "Detalle de un aviso por su id.", { id: z.string() }, ({ id }) => run(() => getAviso(client, id)));

  server.tool(
    "list_my_avisos",
    "Lista los avisos del usuario autenticado (POST requests-list). Acepta filtros opcionales como objeto.",
    { filters: z.record(z.any()).optional() },
    ({ filters }) => run(() => listMyAvisos(client, filters ?? {})),
  );

  return server;
}
