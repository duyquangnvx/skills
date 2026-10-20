import { runCli, type Spawn, TOOL_FAILED, TOOL_MISSING } from "@duyquangnvx/agent-cli";
import { describe, expect, test } from "vitest";
import { cli } from "./cli.js";
import { folderWith, LINKS, pathWith } from "./folder.js";

/** Child processes that answer from `answers`, keyed by the command line, and record each one. */
function fakeSpawn(
  answers: Readonly<Record<string, { exitCode: number; stdout?: string; stderr?: string }>>,
) {
  const ran: string[] = [];
  const spawn: Spawn = async (command, args) => {
    const line = [command, ...args].join(" ");
    ran.push(line);
    const answer = answers[line] ?? { exitCode: 0 };
    return { stdout: answer.stdout ?? "", stderr: answer.stderr ?? "", exitCode: answer.exitCode };
  };
  return { spawn, ran };
}

describe("links commit", () => {
  test("adds links.json and commits it with git", async () => {
    const cwd = await folderWith(LINKS);
    const { spawn, ran } = fakeSpawn({
      "git rev-parse --short HEAD": { exitCode: 0, stdout: "4f2a9c1\n" },
    });

    const result = await runCli(cli, ["commit", "--message", "Add zod"], {
      env: { PATH: await pathWith("git") },
      cwd,
      spawn,
    });

    expect(result).toEqual({
      stdout: "Committed links.json as 4f2a9c1\n",
      stderr: "",
      exitCode: 0,
    });
    expect(ran).toEqual([
      "git add links.json",
      "git commit --message Add zod",
      "git rev-parse --short HEAD",
    ]);
  });

  test("a failing git fails with TOOL_FAILED, exit 2, and the end of its stderr", async () => {
    const cwd = await folderWith(LINKS);
    const { spawn } = fakeSpawn({
      "git commit --message Update links": { exitCode: 1, stderr: "nothing to commit\n" },
    });

    const result = await runCli(cli, ["commit", "--json"], {
      env: { PATH: await pathWith("git") },
      cwd,
      spawn,
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr).errors[0]).toMatchObject({
      code: TOOL_FAILED,
      message: "git exited with 1; its stderr ends:\nnothing to commit",
    });
  });

  test("without git on PATH fails with TOOL_MISSING, exit 2, before running anything", async () => {
    const cwd = await folderWith(LINKS);
    const { spawn, ran } = fakeSpawn({});

    const result = await runCli(cli, ["commit", "--json"], {
      env: { PATH: await pathWith() },
      cwd,
      spawn,
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr).errors[0].code).toBe(TOOL_MISSING);
    expect(ran).toEqual([]);
  });
});
