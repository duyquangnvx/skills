import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Files } from "@duyquangnvx/agent-cli";

export const LINKS = [
  { id: 1, url: "https://zod.dev/", tags: ["docs"] },
  { id: 2, url: "https://vitest.dev/", tags: [] },
];

/** A new temporary folder whose links.json holds `links`. */
export async function folderWith(links: unknown): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "links-"));
  await writeFile(join(cwd, "links.json"), JSON.stringify(links));
  return cwd;
}

/** A folder to use as PATH, holding an empty executable for each name. */
export async function pathWith(...names: readonly string[]): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "links-path-"));
  for (const name of names) {
    if (process.platform === "win32") {
      await writeFile(join(folder, `${name}.cmd`), "@echo off\r\n");
      continue;
    }
    await writeFile(join(folder, name), "#!/bin/sh\n");
    await chmod(join(folder, name), 0o755);
  }
  return folder;
}

/** Files that hold nothing and accept every write, with `overrides` in place of some methods. */
export function fakeFiles(overrides: Partial<Files>): Files {
  return {
    exists: async () => false,
    write: async () => {},
    read: async () => new Uint8Array(),
    list: async () => [],
    remove: async () => {},
    mkdir: async () => {},
    stat: async () => undefined,
    ...overrides,
  };
}

export async function denied(): Promise<never> {
  throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
}
