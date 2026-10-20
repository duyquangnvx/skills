import { setTimeout as wait } from "node:timers/promises";
import { cliError, runCli } from "@duyquangnvx/agent-cli";
import { describe, expect, test } from "vitest";
import { cli } from "./cli.js";
import { errors } from "./errors.js";
import { fakeClock } from "./fake-clock.js";
import { fakePorts } from "./fake-ports.js";
import { folderWith, LINKS } from "./folder.js";
import type { Archive, Capture } from "./ports.js";

/** An archive whose captures stay pending for one poll, then end as `captures` says. */
function fakeArchive(captures: Readonly<Record<string, Capture>>): Archive {
  const polled = new Set<string>();
  return {
    capture: async (url) => url,
    status: async (job) => {
      if (!polled.has(job)) {
        polled.add(job);
        return { state: "pending" };
      }
      return captures[job] ?? { state: "pending" };
    },
  };
}

// Real milliseconds a capture takes on threads the fake clock cannot see, as sharp's work does.
const OFF_THREAD_MS = 20;

const SNAPSHOTS: Record<string, Capture> = {
  "https://zod.dev/": { state: "done", snapshot: "https://web.archive.org/web/1/https://zod.dev/" },
  "https://vitest.dev/": {
    state: "done",
    snapshot: "https://web.archive.org/web/2/https://vitest.dev/",
  },
};

describe("links archive", () => {
  test("--dry-run prints the Plan and its cost", async () => {
    const cwd = await folderWith(LINKS);

    const result = await runCli(cli, ["archive", "--dry-run"], { env: {}, cwd });

    expect(result).toEqual({
      stdout:
        "Would archive 2 links:\n  https://zod.dev/\n  https://vitest.dev/\n" +
        "cost: Archiving 2 links uses 2 of the Wayback Machine's daily captures.\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("without --yes refuses with NOT_CONFIRMED, exit 2, naming the cost", async () => {
    const cwd = await folderWith(LINKS);

    const result = await runCli(cli, ["archive"], {
      env: {},
      cwd,
      ports: fakePorts({ archive: fakeArchive(SNAPSHOTS) }),
    });

    expect(result).toEqual({
      stdout: "",
      stderr:
        "error: `links archive` needs --yes: Archiving 2 links uses 2 of the Wayback Machine's daily captures.\n" +
        "hint: to approve the cost, run `links archive --yes`\n",
      exitCode: 2,
    });
  });

  test("a port's own CliError keeps its code and Exit class", async () => {
    const cwd = await folderWith(LINKS);
    const archive: Archive = {
      capture: async () => {
        throw cliError(errors, "UNREACHABLE", {
          message: "web.archive.org did not answer",
          hint: "run `links archive --yes` again later",
        });
      },
      status: async () => ({ state: "pending" }),
    };

    const result = await runCli(cli, ["archive", "--yes", "--json"], {
      env: {},
      cwd,
      ports: fakePorts({ archive }),
    });

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stderr).errors.map(({ code }: { code: string }) => code)).toEqual([
      "UNREACHABLE",
      "UNREACHABLE",
    ]);
  });

  test("polls each capture until it is done and saves its snapshot", async () => {
    const cwd = await folderWith(LINKS);

    const result = await runCli(cli, ["archive", "--yes"], {
      env: {},
      cwd,
      ports: fakePorts({ archive: fakeArchive(SNAPSHOTS) }),
      clock: fakeClock(),
    });
    const listed = await runCli(cli, ["list", "--fields", "id,snapshot", "--json"], {
      env: {},
      cwd,
    });

    expect(result).toEqual({
      stdout:
        "1  https://web.archive.org/web/1/https://zod.dev/\n" +
        "2  https://web.archive.org/web/2/https://vitest.dev/\n",
      stderr: "",
      exitCode: 0,
    });
    expect(JSON.parse(listed.stdout).items).toEqual([
      { id: 1, snapshot: "https://web.archive.org/web/1/https://zod.dev/" },
      { id: 2, snapshot: "https://web.archive.org/web/2/https://vitest.dev/" },
    ]);
  });

  test("a link the archive cannot capture fails with ARCHIVE_FAILED, exit 3, after the rest", async () => {
    const cwd = await folderWith(LINKS);
    const archive = fakeArchive({
      "https://zod.dev/": { state: "failed", reason: "the site refused the crawler" },
      "https://vitest.dev/": SNAPSHOTS["https://vitest.dev/"] as Capture,
    });

    const result = await runCli(cli, ["archive", "--yes", "--json"], {
      env: {},
      cwd,
      ports: fakePorts({ archive }),
      clock: fakeClock(),
    });

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stdout)).toEqual([
      { id: 2, snapshot: "https://web.archive.org/web/2/https://vitest.dev/" },
    ]);
    expect(JSON.parse(result.stderr)).toEqual({
      errors: [
        {
          code: "ARCHIVE_FAILED",
          message:
            "the Wayback Machine could not capture https://zod.dev/: the site refused the crawler",
          hint: "run `links archive --yes` later to retry the links not archived yet",
          details: { id: 1, url: "https://zod.dev/" },
        },
      ],
    });
  });

  test("a capture request never answered fails with CAPTURE_UNANSWERED, exit 2, after the rest", async () => {
    const cwd = await folderWith(LINKS);
    const archive: Archive = {
      ...fakeArchive(SNAPSHOTS),
      capture: (url, signal) =>
        url === "https://zod.dev/"
          ? new Promise((_resolve, reject) =>
              signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
            )
          : Promise.resolve(url),
    };

    const result = await runCli(cli, ["archive", "--yes", "--json"], {
      env: {},
      cwd,
      ports: fakePorts({ archive }),
      clock: fakeClock(),
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual([
      { id: 2, snapshot: "https://web.archive.org/web/2/https://vitest.dev/" },
    ]);
    expect(JSON.parse(result.stderr)).toEqual({
      errors: [
        {
          code: "CAPTURE_UNANSWERED",
          message: "the Wayback Machine did not answer the capture of https://zod.dev/ in 60000 ms",
          hint: "it may have used one of today's captures: ask your user whether to run `links archive --yes` again",
          details: { id: 1, url: "https://zod.dev/" },
        },
      ],
    });
  });

  test("a capture still running off Node's thread holds the clock when the test says it is busy", async () => {
    const cwd = await folderWith(LINKS);
    let inFlight = 0;
    const archive: Archive = {
      ...fakeArchive(SNAPSHOTS),
      capture: async (url) => {
        inFlight++;
        try {
          await wait(OFF_THREAD_MS);
          return url;
        } finally {
          inFlight--;
        }
      },
    };

    const result = await runCli(cli, ["archive", "--yes"], {
      env: {},
      cwd,
      ports: fakePorts({ archive }),
      clock: fakeClock(() => inFlight > 0),
    });

    expect(result).toEqual({
      stdout:
        "1  https://web.archive.org/web/1/https://zod.dev/\n" +
        "2  https://web.archive.org/web/2/https://vitest.dev/\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("past its run deadline stops with exit 75, prints what it archived and hints how to resume", async () => {
    const cwd = await folderWith(LINKS);
    const archive = fakeArchive({ "https://zod.dev/": SNAPSHOTS["https://zod.dev/"] as Capture });

    const result = await runCli(cli, ["archive", "--yes"], {
      env: {},
      cwd,
      ports: fakePorts({ archive }),
      clock: fakeClock(),
    });

    expect(result).toEqual({
      stdout: "1  https://web.archive.org/web/1/https://zod.dev/\n",
      stderr: "error: links archive ran past its 240000 ms deadline\nhint: links archive --yes\n",
      exitCode: 75,
    });
  });

  test("interrupted, prints what it archived and says how many links are left", async () => {
    const cwd = await folderWith(LINKS);
    const stop = new AbortController();
    const archive: Archive = {
      ...fakeArchive(SNAPSHOTS),
      capture: async (url) => {
        if (url === "https://vitest.dev/") stop.abort();
        return url;
      },
    };

    const result = await runCli(cli, ["archive", "--yes"], {
      env: {},
      cwd,
      ports: fakePorts({ archive }),
      clock: fakeClock(),
      signal: stop.signal,
    });

    expect(result).toEqual({
      stdout: "1  https://web.archive.org/web/1/https://zod.dev/\n",
      stderr:
        "error: interrupted after archiving 1 of 2 links\n" +
        "hint: run `links archive --yes` to archive the rest\n",
      exitCode: 130,
    });
  });
});
