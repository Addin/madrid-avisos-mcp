#!/usr/bin/env node
/**
 * CLI fino sobre el mismo núcleo, para pruebas manuales.
 * Uso: madrid-avisos <comando> [args]
 *   whoami
 *   categories [jurisdiction_id]
 *   category <service_id>
 *   resolve <service_id> <lat> <lng> [jurisdiction_element_id]
 *   aviso <id>
 *   my-avisos
 *   create <service_id> <lat> <lng> [descripción]     (SIEMPRE dry-run; añade --send para enviar)
 *   from-photo <image_path> [service_id] [descripción]   (preview; con --send --token <tok> --yes envía tras revisión humana)
 *   prep-photo <in.jpg> [out.jpg] [--max 2048] [--quality 82]  (reduce para el modelo, conserva EXIF/GPS)
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AvisosClient } from "./client.js";
import {
  createAviso,
  createAvisoFromPhoto,
  getAviso,
  getCategory,
  getProfile,
  listCategories,
  listMyAvisos,
  resolveLocation,
  refreshSession,
} from "./avisos.js";

const client = new AvisosClient();

function out(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

/** Delega en scripts/prep-photo.py (requiere python3 + Pillow en el PATH). */
function prepPhoto(passthru: string[]): never {
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "prep-photo.py");
  const r = spawnSync("python3", [script, ...passthru], { stdio: "inherit" });
  if (r.error) {
    console.error(
      `No se pudo lanzar python3 (${r.error.message}). Alternativa: python3 scripts/prep-photo.py <in.jpg> [out.jpg] (pip install pillow).`,
    );
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const send = args.includes("--send");
  const rest = args.filter((a) => a !== "--send");

  switch (cmd) {
    case "refresh":
      return out(await refreshSession(client));
    case "whoami":
      return out(await getProfile(client));
    case "categories":
      return out(await listCategories(client, rest[0]));
    case "category":
      return out(await getCategory(client, rest[0]));
    case "resolve":
      return out(await resolveLocation(client, rest[0], Number(rest[1]), Number(rest[2]), rest[3]));
    case "aviso":
      return out(await getAviso(client, rest[0]));
    case "my-avisos":
      return out(await listMyAvisos(client));
    case "create":
      return out(
        await createAviso(client, {
          service_id: rest[0],
          lat: Number(rest[1]),
          lng: Number(rest[2]),
          description: rest[3],
          confirm: send, // sin --send => dry-run
        }),
      );
    case "from-photo": {
      // from-photo <path> [service_id] [descripción] [--send --token <tok> --yes]
      const tokIdx = rest.indexOf("--token");
      const token = tokIdx >= 0 ? rest[tokIdx + 1] : undefined;
      const yes = rest.includes("--yes");
      const positional = rest.filter((a, i) => {
        if (a === "--send" || a === "--yes" || a === "--token") return false;
        if (tokIdx >= 0 && i === tokIdx + 1) return false;
        return true;
      });
      return out(
        await createAvisoFromPhoto(client, {
          image_path: positional[0],
          service_id: positional[1],
          description: positional[2],
          confirm: send, // sin --send => preview; con --send exige --token + --yes
          preview_token: token,
          human_confirmed: yes,
        }),
      );
    }
    case "prep-photo":
      return prepPhoto(process.argv.slice(3));
    default:
      console.error(
        "Comandos: whoami | categories [jur] | category <id> | resolve <id> <lat> <lng> [jelem] | aviso <id> | my-avisos | create <id> <lat> <lng> [desc] [--send] | from-photo <path> [id] [desc] [--send --token <tok> --yes] | prep-photo <in> [out] [--max 2048] [--quality 82]",
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
