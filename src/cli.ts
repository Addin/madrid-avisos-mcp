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
import { readFile, writeFile, stat } from "node:fs/promises";
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

import { downscaleForVision, parsePhoto } from "./photo.js";

const client = new AvisosClient();

function out(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

function numOpt(args: string[], name: string, def: number): number {
  const i = args.indexOf(name);
  if (i < 0) {
    const eq = args.find((a) => a.startsWith(name + "="));
    if (!eq) return def;
    const v = Number(eq.slice(name.length + 1));
    return Number.isFinite(v) ? v : def;
  }
  const v = Number(args[i + 1]);
  return Number.isFinite(v) ? v : def;
}

/** Reduce una foto en TS (sin Pillow): conserva EXIF/GPS e informa por JSON. */
async function prepPhoto(passthru: string[]): Promise<void> {
  const positional = passthru.filter((a, i) => {
    if (a.startsWith("--")) return false;
    const prev = passthru[i - 1];
    if (prev === "--max" || prev === "--quality") return false;
    return true;
  });
  const [input, output] = positional;
  if (!input) {
    console.error("Uso: prep-photo <in.jpg> [out.jpg] [--max 2048] [--quality 82]");
    process.exit(1);
  }
  const max = numOpt(passthru, "--max", 2048);
  const quality = numOpt(passthru, "--quality", 80);
  const buf = await readFile(input);
  const before = parsePhoto(buf);
  const small = downscaleForVision(buf, max, quality);
  const dst = output ?? input.replace(/(\.[a-zA-Z0-9]+)?$/, "-ligera$1");
  if (small.resized || dst !== input) await writeFile(dst, small.buffer);
  const info = parsePhoto(small.buffer);
  const stIn = await stat(input);
  const stOut = await stat(dst);
  out({
    ok: true,
    input,
    output: dst,
    orig: { width: before.width, height: before.height, bytes: stIn.size },
    out: { width: small.width || info.width, height: small.height || info.height, bytes: stOut.size },
    resized: small.resized,
    gps: before.gps,
    gps_preserved: JSON.stringify(before.gps) === JSON.stringify(info.gps),
  });
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
