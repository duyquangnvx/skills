import {
  CliError,
  type Context,
  cliError,
  DEADLINE_EXCEEDED,
  INTERRUPTED,
} from "@duyquangnvx/agent-cli";
import * as z from "zod";
import { defineCommand } from "./define.js";
import { errors } from "./errors.js";
import type { Ports } from "./ports.js";
import { type Link, readLinks, writeLinks } from "./store.js";

const CAPTURE_POLL_MS = 5000;
const CAPTURE_TIMEOUT_MS = 60_000;
// Below the two to ten minutes a Coding agent gives a shell call.
const ARCHIVE_DEADLINE_MS = 4 * 60_000;

const archivedSchema = z.object({ id: z.number(), snapshot: z.string() });

type Archived = z.infer<typeof archivedSchema>;

function archiveFailed(link: Link, reason: string, cause?: unknown): CliError {
  return cliError(
    errors,
    "ARCHIVE_FAILED",
    {
      message: `the Wayback Machine could not capture ${link.url}: ${reason}`,
      hint: "run `links archive --yes` later to retry the links not archived yet",
      details: { id: link.id, url: link.url },
    },
    { cause },
  );
}

// A missed run deadline keeps its own error, whose hint is already the resume command.
function stoppedAfter(ctx: Context<Ports>, done: number, total: number): unknown {
  const reason: unknown = ctx.signal.reason;
  if (!(reason instanceof CliError && reason.code === INTERRUPTED)) {
    return reason;
  }
  return new CliError({
    code: INTERRUPTED,
    message: `interrupted after archiving ${done} of ${total} links`,
    hint: `run \`${ctx.commandLine()}\` to archive the rest`,
  });
}

// A sent capture may use one of the day's captures, so neither Ctrl-C nor the run deadline cuts it off.
async function sendCapture(link: Link, ctx: Context<Ports>): Promise<string> {
  try {
    return await ctx.runToEnd("sending the capture", () =>
      ctx.ports.archive.capture(link.url, ctx.timeout(CAPTURE_TIMEOUT_MS)),
    );
  } catch (error) {
    if (!(error instanceof CliError && error.code === DEADLINE_EXCEEDED)) throw error;
    throw cliError(
      errors,
      "CAPTURE_UNANSWERED",
      {
        message: `the Wayback Machine did not answer the capture of ${link.url} in ${CAPTURE_TIMEOUT_MS} ms`,
        hint: "it may have used one of today's captures: ask your user whether to run `links archive --yes` again",
        details: { id: link.id, url: link.url },
      },
      { cause: error },
    );
  }
}

async function snapshotOf(link: Link, ctx: Context<Ports>): Promise<string> {
  const { archive } = ctx.ports;
  let capture: Awaited<ReturnType<typeof archive.status>>;
  try {
    const job = await sendCapture(link, ctx);
    capture = await ctx.poll(
      async () => {
        const status = await archive.status(job, ctx.signal);
        return status.state === "pending" ? undefined : status;
      },
      { intervalMs: CAPTURE_POLL_MS },
    );
  } catch (error) {
    // An interrupt or a missed deadline already carries the right error.
    if (ctx.signal.aborted) {
      throw ctx.signal.reason;
    }
    if (error instanceof CliError) {
      throw error;
    }
    throw archiveFailed(link, error instanceof Error ? error.message : String(error), error);
  }
  if (capture.state === "failed") {
    throw archiveFailed(link, capture.reason);
  }
  return capture.snapshot;
}

async function saveSnapshot(ctx: Context<Ports>, archived: Archived): Promise<void> {
  const links = await readLinks(ctx);
  await writeLinks(
    ctx,
    links.map((link) =>
      link.id === archived.id ? { ...link, snapshot: archived.snapshot } : link,
    ),
  );
}

export const archive = defineCommand({
  name: "archive",
  description: "Save a snapshot of each link not archived yet in the Wayback Machine",
  examples: [
    { command: "links archive --dry-run", note: "show the links it would archive and the cost" },
    { command: "links archive --tag docs --yes", note: "archive the links tagged docs" },
  ],
  effect: "write",
  options: z.object({
    tag: z.string().optional().describe("only archive links with this tag"),
  }),
  output: z.array(archivedSchema),
  deadline: {
    ms: ARCHIVE_DEADLINE_MS,
    // Archived links are skipped, so running the same command again continues the work.
    resume: (_input, commandLine) => commandLine(),
  },
  plan: async ({ tag }, ctx) => {
    const links = await readLinks(ctx);
    return {
      archive: links.filter(
        (link) => link.snapshot === undefined && (tag === undefined || link.tags.includes(tag)),
      ),
    };
  },
  cost: (plan) =>
    plan.archive.length === 0
      ? undefined
      : `Archiving ${plan.archive.length} links uses ${plan.archive.length} of the Wayback Machine's daily captures.`,
  apply: async (plan, ctx) => {
    let archived: Archived[] = [];
    let failures: unknown[] = [];
    for (const link of plan.archive) {
      try {
        const done = { id: link.id, snapshot: await snapshotOf(link, ctx) };
        await ctx.runToEnd("saving the links", () => saveSnapshot(ctx, done));
        archived = [...archived, done];
        ctx.deliver(archived);
      } catch (error) {
        if (ctx.signal.aborted) {
          throw stoppedAfter(ctx, archived.length, plan.archive.length);
        }
        failures = [...failures, error];
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `${failures.length} links were not archived`);
    }
    return archived;
  },
  render: (archived) =>
    archived.length === 0
      ? "Nothing to archive."
      : archived.map((link) => `${link.id}  ${link.snapshot}`).join("\n"),
  renderPlan: (plan) =>
    plan.archive.length === 0
      ? "Nothing to archive."
      : `Would archive ${plan.archive.length} links:\n${plan.archive.map((link) => `  ${link.url}`).join("\n")}`,
});
