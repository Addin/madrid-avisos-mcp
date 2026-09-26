#!/usr/bin/env node
/**
 * Entrada STDIO del servidor MCP (para Claude Desktop / Claude Code en local).
 * Para exponerlo por red (Tailscale), usa http.ts.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AvisosClient } from "./client.js";
import { buildServer } from "./mcp.js";

async function main() {
  const client = new AvisosClient();
  const server = buildServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  if (!client.hasToken()) {
    console.error("[madrid-avisos] Aviso: sin MADRID_AVISOS_TOKEN; solo funcionarán llamadas públicas.");
  }
  console.error("[madrid-avisos] MCP servidor listo (stdio).");
}

main().catch((e) => {
  console.error("[madrid-avisos] Error fatal:", e);
  process.exit(1);
});
