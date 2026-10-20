import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PERMISSION_DENIED, runCli } from "@duyquangnvx/agent-cli";
import { describe, expect, test } from "vitest";
import { cli } from "./cli.js";
import { denied, fakeFiles, folderWith, LINKS } from "./folder.js";

describe("links export", () => {
  test("writes the links as a Markdown list", async () => {
    const cwd = await folderWith(LINKS);

    const result = await runCli(cli, ["export", "LINKS.md"], { env: {}, cwd });

    expect(result).toEqual({
      stdout: `Exported 2 links to ${join(cwd, "LINKS.md")}\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(await readFile(join(cwd, "LINKS.md"), "utf8")).toBe(
      "- <https://zod.dev/> (docs)\n- <https://vitest.dev/>\n",
    );
  });

  test("--dry-run lists the file it would write", async () => {
    const cwd = await folderWith(LINKS);

    const result = await runCli(cli, ["export", "LINKS.md", "--dry-run"], { env: {}, cwd });

    expect(result.stdout).toBe("Would export 2 links to LINKS.md\noutputs:\n  LINKS.md\n");
  });

  test("an existing file refuses with OUTPUT_EXISTS, exit 1, until --force", async () => {
    const cwd = await folderWith(LINKS);
    await writeFile(join(cwd, "LINKS.md"), "mine\n");

    const refused = await runCli(cli, ["export", "LINKS.md"], { env: {}, cwd });
    const forced = await runCli(cli, ["export", "LINKS.md", "--force"], { env: {}, cwd });

    expect(refused).toEqual({
      stdout: "",
      stderr:
        "error: `links export` would overwrite LINKS.md\n" +
        "hint: to replace it, run `links export LINKS.md --force`\n",
      exitCode: 1,
    });
    expect(forced.exitCode).toBe(0);
    expect(await readFile(join(cwd, "LINKS.md"), "utf8")).toContain("https://zod.dev/");
  });

  test("a file it may not write fails with PERMISSION_DENIED, exit 2", async () => {
    const cwd = await folderWith(LINKS);

    const result = await runCli(cli, ["export", "LINKS.md", "--json"], {
      env: {},
      cwd,
      files: fakeFiles({ write: denied }),
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({ errors: [{ code: PERMISSION_DENIED }] });
  });
});
