/**
 * Esquemas (zod) de entrada de las herramientas y tipos del payload de creación.
 * El esquema de creación replica la rama CityApp del serializador de la app (lle.g).
 */
import { z } from "zod";

/** Respuesta a una pregunta del formulario dinámico (additional_data / location_additional_data). */
export const AdditionalAnswer = z.object({
  question: z.string().describe("id de la pregunta (campo 'id' devuelto por get_category / resolve_location)"),
  value: z
    .union([z.string(), z.array(z.string())])
    .describe("respuesta; array si la pregunta es multivalor"),
});
export type AdditionalAnswer = z.infer<typeof AdditionalAnswer>;

/** Datos del ciudadano que reporta. En cuenta registrada suelen tomarse del perfil. */
export const Informant = z
  .object({
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    phone: z.string().optional(),
    secondary_phone: z.string().optional(),
    email: z.string().optional(),
    id_document: z.string().optional().describe("DNI/NIE"),
    address: z.string().optional(),
  })
  .describe("Datos del informante (opcional)");
export type Informant = z.infer<typeof Informant>;

/** Entrada de la herramienta create_aviso. */
export const CreateAvisoInput = z.object({
  service_id: z.string().describe("id de la categoría/servicio (de list_categories)"),
  jurisdiction_id: z.string().optional().describe("por defecto es.madrid"),
  lat: z.number().describe("latitud"),
  lng: z.number().describe("longitud"),
  description: z.string().optional().describe("descripción del problema"),
  public: z.boolean().optional().describe("aviso público (por defecto true)"),
  address_string: z.string().optional(),
  level: z.number().int().optional().describe("planta/nivel (indoor)"),
  priority: z.string().optional(),
  jurisdiction_element: z.string().optional().describe("id de elemento de jurisdicción (distrito/zona)"),
  situation: z.string().optional(),
  zones: z.array(z.string()).optional(),
  location_additional_data: z.array(AdditionalAnswer).optional().describe("respuestas a preguntas de ubicación (tipo_via, etc.)"),
  additional_data: z.array(AdditionalAnswer).optional().describe("respuestas al formulario del servicio"),
  informant: Informant.optional(),
  device_type: z.string().optional().describe("id del origin-device del canal (se resuelve solo al canal android; no pasar 'android')"),
  confirm: z
    .boolean()
    .optional()
    .describe("DEBE ser true para ENVIAR de verdad. Por defecto false = dry-run (no crea nada)."),
});
export type CreateAvisoInput = z.infer<typeof CreateAvisoInput>;

/** Entrada de la herramienta create_aviso_from_photo (dos fases con confirmación humana). */
export const CreateAvisoFromPhotoInput = z.object({
  image_base64: z.string().optional().describe("foto como base64 (puro o data URL). Solo para fotos pequeñas ya visibles"),
  image_path: z.string().optional().describe("ruta local a la foto. Solo stdio/CLI en la máquina del servidor"),
  file_id: z.string().optional().describe("VÍA PREFERIDA en remoto: id de PUT /upload (el modelo no procesa los bytes originales)"),
  service_id: z.string().optional().describe("id de la categoría. Si falta, devuelve sugerencias y no crea nada"),
  category_hint: z
    .string()
    .optional()
    .describe("palabras del agente que vio la foto (p.ej. 'cartones apilados en acera') para sugerir categoría"),
  description: z.string().optional().describe("descripción del problema. Si falta, se pre-rellena y se marca para revisión"),
  lat: z.number().optional().describe("sobrescribe el GPS EXIF de la foto"),
  lng: z.number().optional().describe("sobrescribe el GPS EXIF de la foto"),
  jurisdiction_id: z.string().optional(),
  public: z.boolean().optional(),
  address_string: z.string().optional(),
  level: z.number().int().optional(),
  priority: z.string().optional(),
  jurisdiction_element: z.string().optional(),
  situation: z.string().optional(),
  zones: z.array(z.string()).optional(),
  location_additional_data: z.array(AdditionalAnswer).optional(),
  additional_data: z.array(AdditionalAnswer).optional(),
  informant: Informant.optional(),
  device_type: z.string().optional(),
  confirm: z.boolean().optional().describe("true = ENVIAR de verdad (requiere preview_token + human_confirmed)"),
  preview_token: z.string().optional().describe("token devuelto por el preview; liga el envío con lo que vio el humano"),
  human_confirmed: z.boolean().optional().describe("el humano vio el preview y dijo 'sí'. Obligatorio para enviar"),
});
export type CreateAvisoFromPhotoInput = z.infer<typeof CreateAvisoFromPhotoInput>;

/** Cuerpo JSON del POST requests (rama CityApp). */
export interface CreateAvisoPayload {
  jurisdiction_id?: string;
  service_id: string;
  public: boolean;
  device_type: string;
  description?: string;
  priority?: string;
  lat?: number;
  long?: number; // OJO: la creación usa "long", no "lng"
  level?: number;
  address_string?: string;
  zones?: string[];
  jurisdiction_element?: string;
  situation?: string;
  location_additional_data?: Array<{ value: string | string[]; question: string }>;
  /** OJO: en el cable es "additionalData" (camelCase), como lo manda la app (lle.java). */
  additionalData?: Array<{ question: string; value: string | string[] }>;
  // Campos de informante (planos en el cuerpo)
  first_name?: string;
  last_name?: string;
  phone?: string;
  secondary_phone?: string;
  email?: string;
  id_document?: string;
  address?: string;
}
