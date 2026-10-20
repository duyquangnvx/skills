import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runCli } from "@duyquangnvx/agent-cli";
import { describe, expect, test } from "vitest";
import { cli } from "./cli.js";
import { folderWith, LINKS } from "./folder.js";

describe("links bundle", () => {
  test("writes one shortcut file per link into a new folder", async () => {
    const cwd = await folderWith(LINKS);

    const result = await runCli(cli, ["bundle", "docs", "1", "2"], { env: {}, cwd });

    expect(result).toEqual({
      stdout: `Bundled 2 links into ${resolve(cwd, "docs")}\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(await readdir(resolve(cwd, "docs"))).toEqual(["1.url", "2.url"]);
    expect(await readFile(resolve(cwd, "docs", "1.url"), "utf8")).toBe(
      "[InternetShortcut]\r\nURL=https://zod.dev/\r\n",
    );
  });

  test("an existing folder refuses with BUNDLE_EXISTS, exit 1, hinting --force", async () => {
    const cwd = await folderWith(LINKS);
    await mkdir(resolve(cwd, "docs"));
    await writeFile(resolve(cwd, "docs", "notes.txt"), "mine\n");

    const result = await runCli(cli, ["bundle", "docs", "1"], { env: {}, cwd });

    expect(result).toEqual({
      stdout: "",
      stderr:
        "error: docs already exists\n" +
        "hint: to replace it and everything in it, run `links bundle docs 1 --force`\n",
      exitCode: 1,
    });
    expect(await readdir(resolve(cwd, "docs"))).toEqual(["notes.txt"]);
  });

  test("--force replaces the folder, and its dry run names what it removes", async () => {
    const cwd = await folderWith(LINKS);
    await mkdir(resolve(cwd, "docs"));
    await writeFile(resolve(cwd, "docs", "notes.txt"), "mine\n");

    const dryRun = await runCli(cli, ["bundle", "docs", "1", "--force", "--dry-run"], {
      env: {},
      cwd,
    });
    const forced = await runCli(cli, ["bundle", "docs", "1", "--force"], { env: {}, cwd });

    expect(dryRun.stdout).toBe("Would bundle 1 links into docs, removing notes.txt\n");
    expect(forced.exitCode).toBe(0);
    expect(await readdir(resolve(cwd, "docs"))).toEqual(["1.url"]);
  });
});
