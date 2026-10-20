import { createServer } from "node:net";
import { runCli } from "@duyquangnvx/agent-cli";
import { describe, expect, test } from "vitest";
import { cli } from "./cli.js";
import { folderWith, LINKS } from "./folder.js";

const RETRY_MS = 10;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

/** The page at `url`, asked again until the server is up. */
async function pageAt(url: string): Promise<string> {
  for (;;) {
    try {
      return await (await fetch(url)).text();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

describe("links serve", () => {
  test("serves the links until stopped, then exits 0", async () => {
    const cwd = await folderWith(LINKS);
    const port = await freePort();
    const stop = new AbortController();

    const run = runCli(cli, ["serve", "--port", String(port)], {
      env: {},
      cwd,
      signal: stop.signal,
    });
    const page = await pageAt(`http://127.0.0.1:${port}/`);
    stop.abort();

    expect(page).toContain('<a href="https://zod.dev/">https://zod.dev/</a>');
    expect(await run).toEqual({
      stdout: `Serving the links at http://127.0.0.1:${port}/ until Ctrl-C\n`,
      stderr: "",
      exitCode: 0,
    });
  });
});
