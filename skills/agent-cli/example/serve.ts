import { createServer } from "node:http";
import * as z from "zod";
import { defineCommand } from "./define.js";
import { type Link, readLinks } from "./store.js";

const DEFAULT_PORT = 4173;
const HOST = "127.0.0.1";

function pageOf(links: readonly Link[]): string {
  const items = links.map((link) => `<li><a href="${link.url}">${link.url}</a></li>`).join("");
  return `<!doctype html><title>Links</title><ul>${items}</ul>\n`;
}

export const serve = defineCommand({
  name: "serve",
  description: "Serve the links as a web page until stopped",
  examples: [
    { command: "links serve", note: `serve the links at http://${HOST}:${DEFAULT_PORT}/` },
    { command: "links serve --port 8080", note: "serve them on port 8080" },
  ],
  effect: "serve",
  options: z.object({
    port: z.number().int().positive().default(DEFAULT_PORT).describe("the port to listen on"),
  }),
  output: z.object({ url: z.string() }),
  start: async ({ port }, ctx) => {
    const server = createServer(async (_request, response) => {
      try {
        const links = await readLinks(ctx);
        response.writeHead(200, { "content-type": "text/html" }).end(pageOf(links));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        response.writeHead(500, { "content-type": "text/plain" }).end(`${message}\n`);
      }
    });
    await new Promise<void>((resolve) => server.listen(port, HOST, resolve));
    ctx.signal.addEventListener("abort", () => server.close(), { once: true });
    return { url: `http://${HOST}:${port}/` };
  },
  render: ({ url }) => `Serving the links at ${url} until Ctrl-C`,
});
