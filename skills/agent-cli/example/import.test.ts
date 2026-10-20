import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runCli } from "@duyquangnvx/agent-cli";
import { describe, expect, test } from "vitest";
import { cli } from "./cli.js";
import { folderWith, LINKS } from "./folder.js";

describe("links import", () => {
  test("- reads the text from stdin and saves each link in it not saved yet", async () => {
    const cwd = await folderWith(LINKS);
    const notes = "Read https://zod.dev/ and https://biomejs.dev/.\nThen (https://pnpm.io).\n";

    const result = await runCli(cli, ["import", "-"], { env: {}, cwd, stdin: notes });

    expect(result).toEqual({
      stdout: "Saved link 3: https://biomejs.dev/\nSaved link 4: https://pnpm.io\n",
      stderr: "",
      exitCode: 0,
    });
    expect(JSON.parse(await readFile(join(cwd, "links.json"), "utf8"))).toHaveLength(4);
  });

  test("a repeated --tag gives each link every tag, in order", async () => {
    const cwd = await folderWith([]);

    const result = await runCli(
      cli,
      ["import", "see https://zod.dev", "--tag", "docs", "--tag=zod", "--json"],
      { env: {}, cwd },
    );

    expect(JSON.parse(result.stdout)).toEqual([
      { id: 1, url: "https://zod.dev", tags: ["docs", "zod"] },
    ]);
  });

  test("an empty stdin is a usage error and saves nothing", async () => {
    const cwd = await folderWith([]);

    const result = await runCli(cli, ["import", "-"], { env: {}, cwd, stdin: "" });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(await readFile(join(cwd, "links.json"), "utf8")).toBe("[]");
  });

  test("--help shows the stdin form, and the help paragraph after the options", async () => {
    const result = await runCli(cli, ["import", "--help"], { env: {}, cwd: "." });

    expect(result.stdout).toContain("  <text|->  the text holding the links");
    expect(result.stdout).toMatch(/Options:[\s\S]*\n\nGive - to read the text from stdin, /);
  });
});
