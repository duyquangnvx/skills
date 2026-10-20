# Long runs: deadlines, Ctrl-C, jobs, queues, progress, servers and data that outlives a failure

## Cancellation and deadlines

- Pass `ctx.signal` to `fetch` and the ports, so Ctrl-C stops the work.
- Run every call to a slow outside system under `ctx.deadline(ms)`, so the Command fails clearly instead of hanging the agent. A billed call that Ctrl-C must not cut short runs under `ctx.timeout(ms)` instead (Deadlines in [`remote-services.md`](remote-services.md)).
- Build every hint that names a command to run with `ctx.commandLine`, as in `ctx.commandLine({ remove: ["--from"], add: ["--from", String(next)] })`, never by hand.
- A run that could outlast the caller's tool timeout declares a `deadline`, whose `resume` returns the command that continues the work. Once that run deadline hits, the run ends with `DEADLINE_EXCEEDED` whatever the Command then throws, so `deliver` what is done and say in that data which work is still pending:

  ```ts
  deadline: {
    ms: ARCHIVE_DEADLINE_MS,
    // Archived links are skipped, so running the same command again continues the work.
    resume: (_input, commandLine) => commandLine(),
  },
  ```

- Wrap a step that must not stop halfway, such as writing a file, in `ctx.runToEnd`.
- Poll through `ctx.poll`, which runs on `ctx.clock` so a test runs it instantly; pass `signal: ctx.deadline(ms)` to stop at a `--wait` deadline rather than one interval after it.

  ```ts
  capture = await ctx.poll(
    async () => {
      const status = await archive.status(job, ctx.signal);
      return status.state === "pending" ? undefined : status;
    },
    { intervalMs: CAPTURE_POLL_MS },
  );
  ```

## Work that outlives any deadline

When remote work runs longer than a caller can wait, split it into two Commands: a `write` Command that starts the job and returns its id, and a `read` Command that takes the id and an optional `--wait <seconds>`, polls under `ctx.deadline`, and while the job still runs fails with a `wait` code whose hint is its own command line. Rerunning the start Command with the same input finds the running job where the service allows, rather than starting another.

## Servers

A `serve` Command keeps running, such as a preview server: `start(input, ctx)` returns data, which prints at once, and the run lasts until `ctx.signal` aborts. Stop the work on the signal:

```ts
await new Promise<void>((resolve) => server.listen(port, HOST, resolve));
ctx.signal.addEventListener("abort", () => server.close(), { once: true });
return { url: `http://${HOST}:${port}/` };
```

## Queues

A Command that works through a list of free work stops at the first fatal error and at Ctrl-C: give each item `AbortSignal.any([ctx.signal, stop.signal])` and abort `stop` from the first failure. Paid work lets every item finish instead (Paid calls in [`remote-services.md`](remote-services.md)).

- Write what a rerun resumes from (a manifest, the outputs list) before the queue starts, and `ctx.deliver` the shared list after each item, never a fresh copy per item, which turns quadratic.
- Call `signal.throwIfAborted()` after taking a concurrency slot, so every waiting item sees the abort.
- Start an item's error message with where it happened (`chapter 7, segment 31: …`).

## Progress

- One `ctx.progress` line per event: no `\r` and no spinners, since stderr is often a log file.
- An ETA comes from the pace measured in this run, not a constant.
- A tool silent for minutes looks hung: run it with `progress: true` and ask it for periodic output (`ffmpeg -progress pipe:2 -stats_period 10`).
- Each item's done line says what it took: time, and what it consumed (tokens, bytes); where a limit caps each call, the largest single call.
- A fact that belongs to the result goes in the data, never only in progress, which a caller reading stdout never sees.

## Wrapping a failure

When you wrap an outside failure in your own `CliError`, let the abort reason through first, so an interrupt or a missed deadline keeps its own code, and then a `CliError` the port already classified:

```ts
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
```

Keep the original error as `cause` whenever you wrap one, as `archiveFailed` does, and make an adapter or SDK wrapper do the same: an error that is not a `CliError` and whose `cause` chain holds a `ctx.deadline`'s or `ctx.timeout`'s abort is reported as that `DEADLINE_EXCEEDED`. Any other, a `CliError` keeping the abort as `cause` included, is reported as it is, even after a deadline fired.

The Runtime's `INTERRUPTED` says only "run the command again". When the Command knows more, such as what it finished or that a request was never sent, throw its own `CliError` with the code `INTERRUPTED` once `ctx.signal` aborted: it wins over the Runtime's and keeps exit 130 or 143. Compare `ctx.signal.reason` with the exported `INTERRUPTED` and `DEADLINE_EXCEEDED`, so a missed deadline keeps its own error:

```ts
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
```

## Data that outlives a failure

Call `ctx.deliver` with the data done so far after each finished piece, so a run that then fails, hits a deadline or is interrupted still prints it and the caller keeps the finished work.

```ts
const done = { id: link.id, snapshot: await snapshotOf(link, ctx) };
await ctx.runToEnd("saving the links", () => saveSnapshot(ctx, done));
archived = [...archived, done];
ctx.deliver(archived);
```
