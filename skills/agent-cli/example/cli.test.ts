import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEADLINE_EXCEEDED,
  INTERRUPTED,
  PERMISSION_DENIED,
  PROJECT_INVALID,
  runCli,
} from "@duyquangnvx/agent-cli";
import { afterEach, describe, expect, test } from "vitest";
import { cli } from "./cli.js";
import { fakePorts } from "./fake-ports.js";
import { denied, fakeFiles, folderWith, LINKS, pathWith } from "./folder.js";

describe("links list", () => {
  test("prints one link per line, then how many were shown", async () => {
    const cwd = await folderWith(LINKS);

    const result = await runCli(cli, ["list"], { env: {}, cwd });

    expect(result).toEqual({
      stdout: "1  https://zod.dev/\n2  https://vitest.dev/\n2 shown; no more pages\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("--fields keeps only the named fields under --json", async () => {
    const cwd = await folderWith(LINKS);

    const result = await runCli(cli, ["list", "--fields", "id,url", "--json"], { env: {}, cwd });

    expect(JSON.parse(result.stdout)).toEqual({
      items: [
        { id: 1, url: "https://zod.dev/" },
        { id: 2, url: "https://vitest.dev/" },
      ],
    });
  });

  test("--limit returns a page and the command for the next one", async () => {
    const cwd = await folderWith(LINKS);

    const result = await runCli(cli, ["list", "--limit", "1", "--json"], { env: {}, cwd });

    expect(JSON.parse(result.stdout)).toEqual({
      items: [LINKS[0]],
      next: "links list --limit 1 --json --cursor 1",
    });
  });

  test("a corrupt links.json fails with exit 1 and a hint", async () => {
    const cwd = await folderWith("not links");

    const result = await runCli(cli, ["list", "--json"], { env: {}, cwd });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ errors: [{ code: "CORRUPT_DATA" }] });
  });

  test("a links.json it may not read fails with PERMISSION_DENIED, exit 2", async () => {
    const cwd = await folderWith(LINKS);

    const result = await runCli(cli, ["list", "--json"], {
      env: {},
      cwd,
      files: fakeFiles({ exists: async () => true, read: denied }),
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({ errors: [{ code: PERMISSION_DENIED }] });
  });
});

describe("links add", () => {
  test("--dry-run prints the Plan and saves nothing", async () => {
    const cwd = await folderWith([]);

    const result = await runCli(cli, ["add", "https://zod.dev", "--dry-run"], { env: {}, cwd });

    expect(result).toEqual({
      stdout: "Would save link 1: https://zod.dev\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await readFile(join(cwd, "links.json"), "utf8")).toBe("[]");
  });

  test("saves the link", async () => {
    const cwd = await folderWith([]);

    await runCli(cli, ["add", "https://zod.dev", "--tag", "docs"], { env: {}, cwd });
    const listed = await runCli(cli, ["list", "--json"], { env: {}, cwd });

    expect(JSON.parse(listed.stdout)).toEqual({
      items: [{ id: 1, url: "https://zod.dev", tags: ["docs"] }],
    });
  });

  test("tags the link with the Project file's tag when --tag is absent", async () => {
    const root = await folderWith([]);
    await writeFile(join(root, "links.config.json"), JSON.stringify({ tag: "work" }));
    const cwd = join(root, "notes");
    await mkdir(cwd);

    const result = await runCli(cli, ["add", "https://zod.dev", "--json"], { env: {}, cwd });

    expect(JSON.parse(result.stdout)).toEqual({ id: 1, url: "https://zod.dev", tags: ["work"] });
  });

  test("a Project file that fails its schema is PROJECT_INVALID, exit 2", async () => {
    const cwd = await folderWith([]);
    await writeFile(join(cwd, "links.config.json"), JSON.stringify({ tag: 3 }));

    const result = await runCli(cli, ["add", "https://zod.dev", "--json"], { env: {}, cwd });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({ errors: [{ code: PROJECT_INVALID }] });
  });

  test("an address that is not a URL is a usage error", async () => {
    const cwd = await folderWith([]);

    const result = await runCli(cli, ["add", "zod"], { env: {}, cwd });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });
});

describe("links remove", () => {
  test("without --confirm deletes nothing and hints the exact command", async () => {
    const cwd = await folderWith(LINKS);

    const result = await runCli(cli, ["remove", "1"], { env: {}, cwd });

    expect(result).toEqual({
      stdout: "",
      stderr:
        "error: `links remove` is destructive and needs --confirm\n" +
        "hint: to confirm, run `links remove 1 --confirm https://zod.dev/`\n",
      exitCode: 1,
    });
  });

  test("with --confirm naming the link's url deletes it", async () => {
    const cwd = await folderWith(LINKS);

    const result = await runCli(cli, ["remove", "1", "--confirm", "https://zod.dev/"], {
      env: {},
      cwd,
    });

    expect(result.stdout).toBe("Deleted link 1: https://zod.dev/\n");
    expect(JSON.parse(await readFile(join(cwd, "links.json"), "utf8"))).toEqual([LINKS[1]]);
  });
});

describe("links check", () => {
  let server: Server | undefined;
  let authorization: string | undefined;

  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
  });

  async function serve(answer: boolean): Promise<string> {
    server = createServer((request, response) => {
      authorization = request.headers.authorization;
      if (answer) {
        response.writeHead(204).end();
      }
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  }

  test("prints the status the link answers with", async () => {
    const url = await serve(true);
    const cwd = await folderWith([{ id: 1, url, tags: [] }]);

    const result = await runCli(cli, ["check", "1", "--json"], { env: {}, cwd });

    expect(JSON.parse(result.stdout)).toEqual({ id: 1, url, status: 204 });
    expect(authorization).toBeUndefined();
  });

  test("sends LINKS_TOKEN, which the ports factory reads, as a bearer token", async () => {
    const url = await serve(true);
    const cwd = await folderWith([{ id: 1, url, tags: [] }]);

    await runCli(cli, ["check", "1"], { env: { LINKS_TOKEN: "t0ken" }, cwd });

    expect(authorization).toBe("Bearer t0ken");
  });

  test("a link that never answers fails with DEADLINE_EXCEEDED, exit 75", async () => {
    const url = await serve(false);
    const cwd = await folderWith([{ id: 1, url, tags: [] }]);

    const result = await runCli(cli, ["check", "1", "--timeout", "100", "--json"], {
      env: {},
      cwd,
    });

    expect(result.exitCode).toBe(75);
    expect(JSON.parse(result.stderr)).toMatchObject({ errors: [{ code: DEADLINE_EXCEEDED }] });
  });

  test("an interrupted check fails with INTERRUPTED, exit 130", async () => {
    const url = await serve(false);
    const cwd = await folderWith([{ id: 1, url, tags: [] }]);

    const result = await runCli(cli, ["check", "1", "--json"], {
      env: {},
      cwd,
      signal: AbortSignal.timeout(100),
    });

    expect(result.exitCode).toBe(130);
    expect(JSON.parse(result.stderr)).toMatchObject({ errors: [{ code: INTERRUPTED }] });
  });
});

describe("links doctor", () => {
  async function doctor(env: Record<string, string>, config?: unknown) {
    const cwd = await folderWith(LINKS);
    if (config !== undefined) {
      await writeFile(join(cwd, "links.config.json"), JSON.stringify(config));
    }
    const home = await mkdtemp(join(tmpdir(), "links-home-"));
    const result = await runCli(cli, ["doctor", "--json"], {
      env: { HOME: home, USERPROFILE: home, ...env },
      cwd,
    });
    const report = JSON.parse(result.stdout);
    const row = (name: string): unknown =>
      report.rows.find(({ check }: { check: string }) => check === name);
    return { cwd, home, result, report, row };
  }

  test("reports the store row", async () => {
    const { cwd, result, row } = await doctor({ PATH: await pathWith("git") });

    expect(result.exitCode).toBe(0);
    expect(row("store")).toEqual({
      check: "store",
      state: "ok",
      message: `${join(cwd, "links.json")} holds 2 links`,
    });
  });

  test("the tag row reads the Project file's tag", async () => {
    const { row } = await doctor({ PATH: await pathWith("git") }, { tag: "work" });

    expect(row("tag")).toEqual({
      check: "tag",
      state: "ok",
      message: "`links add` tags a link work unless given --tag",
    });
  });

  test("the tag row says links stay untagged without a Project file", async () => {
    const { row } = await doctor({ PATH: await pathWith("git") });

    expect(row("tag")).toEqual({
      check: "tag",
      state: "ok",
      message: "`links add` leaves a link untagged unless given --tag",
    });
  });

  test("an invalid Project file skips the tag row and fails doctor once, as PROJECT_INVALID", async () => {
    const { result, row } = await doctor({ PATH: await pathWith("git") }, { tag: 3 });

    expect(row("tag")).toMatchObject({ check: "tag", state: "skipped" });
    expect(JSON.parse(result.stderr).errors.map(({ code }: { code: string }) => code)).toEqual([
      PROJECT_INVALID,
    ]);
    expect(result.exitCode).toBe(2);
  });

  test("a missing token is an advisory problem: its fix shows and doctor still exits 0", async () => {
    const { home, result, report, row } = await doctor({ PATH: await pathWith("git") });
    const fix = `add LINKS_TOKEN=<token> to ${join(home, ".config", "links", ".env")}`;

    expect(row("token")).toEqual({
      check: "token",
      state: "problem",
      message: "LINKS_TOKEN is not set; `links check` sends no token",
      fix,
    });
    expect(report.next).toEqual([fix]);
    expect(result.exitCode).toBe(0);
  });

  test("a missing git fails doctor with exit 2, its install command as the fix", async () => {
    const { result, row } = await doctor({ PATH: await pathWith() });

    expect(row("git")).toMatchObject({ check: "git", state: "problem", fix: "brew install git" });
    expect(result.exitCode).toBe(2);
  });

  test("reports where the token came from and never its value", async () => {
    const cwd = await folderWith(LINKS);
    const home = await mkdtemp(join(tmpdir(), "links-home-"));
    await mkdir(join(home, ".config", "links"), { recursive: true });
    const dotenv = join(home, ".config", "links", ".env");
    await writeFile(dotenv, "LINKS_TOKEN=secret-from-file\n");
    const env = { HOME: home, USERPROFILE: home };
    const tokenRow = (stdout: string): unknown =>
      JSON.parse(stdout).rows.find(({ check }: { check: string }) => check === "token");

    const fromFile = await runCli(cli, ["doctor", "--json"], { env, cwd });
    const fromEnv = await runCli(cli, ["doctor", "--json"], {
      env: { ...env, LINKS_TOKEN: "secret-from-env" },
      cwd,
    });

    expect(tokenRow(fromFile.stdout)).toEqual({
      check: "token",
      state: "ok",
      message: `LINKS_TOKEN is set in ${dotenv}`,
    });
    expect(tokenRow(fromEnv.stdout)).toEqual({
      check: "token",
      state: "ok",
      message: "LINKS_TOKEN is set in the environment",
    });
    expect(fromFile.stdout + fromEnv.stdout).not.toContain("secret-from");
  });
});

describe("the usage count", () => {
  const COLLECTOR = "https://usage.example.com/links";

  function countingPorts() {
    const counted: (readonly [string, readonly string[]])[] = [];
    const ports = fakePorts({
      usage: {
        count: async (url, command) => {
          counted.push([url, command]);
        },
      },
    });
    return { ports, counted };
  }

  test("counts a run of a Command at the collector LINKS_USAGE_URL names", async () => {
    const cwd = await folderWith([]);
    const { ports, counted } = countingPorts();

    const result = await runCli(cli, ["add", "https://zod.dev"], {
      env: { LINKS_USAGE_URL: COLLECTOR },
      cwd,
      ports,
    });

    expect(result.exitCode).toBe(0);
    expect(counted).toEqual([[COLLECTOR, ["add"]]]);
  });

  test.each([
    ["without LINKS_USAGE_URL", {}, ["add", "https://zod.dev"]],
    ["for a dry run", { LINKS_USAGE_URL: COLLECTOR }, ["add", "https://zod.dev", "--dry-run"]],
  ])("counts nothing %s", async (_name, env, argv) => {
    const cwd = await folderWith([]);
    const { ports, counted } = countingPorts();

    await runCli(cli, argv, { env, cwd, ports });

    expect(counted).toEqual([]);
  });

  test("a collector that fails changes nothing the caller sees", async () => {
    const cwd = await folderWith([]);
    const ports = fakePorts({
      usage: {
        count: async () => {
          throw new Error("the collector is down");
        },
      },
    });

    const result = await runCli(cli, ["add", "https://zod.dev"], {
      env: { LINKS_USAGE_URL: COLLECTOR },
      cwd,
      ports,
    });

    expect(result).toEqual({ stdout: "Saved link 1: https://zod.dev\n", stderr: "", exitCode: 0 });
  });
});

describe("links --help --json", () => {
  test("describes a Command's Effect and the JSON Schema of its output", async () => {
    const result = await runCli(cli, ["check", "--help", "--json"], { env: {}, cwd: "." });

    const help = JSON.parse(result.stdout);
    expect(help).toMatchObject({ name: "links check", effect: "read" });
    expect(help.output.required).toEqual(["id", "url", "status"]);
  });

  test("lists the Error table with each code's Exit class", async () => {
    const result = await runCli(cli, ["--help", "--json"], { env: {}, cwd: "." });

    expect(JSON.parse(result.stdout).errors).toMatchObject({
      LINK_NOT_FOUND: { class: "caller" },
      ARCHIVE_FAILED: { class: "source" },
    });
  });
});
