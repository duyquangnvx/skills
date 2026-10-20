# Remote services: ports, retries, work you cannot take back, paid calls, a Side task

## Ports

A port is an outside system the CLI talks to, such as an HTTP API, behind an interface you declare in `agentCli<Ports>()`. `defineCli({ ports })` takes the factory that builds the real ones, and `runCli`'s `ports` option replaces them in a test. The factory receives `PortsBase`, the same helpers a Command gets, so an adapter reads its key or a shipped file as a Command does. Each port method takes the signal of its call, `ctx.signal`, a `ctx.deadline` or, for a billed call, a `ctx.timeout`, as `Web.status` does. A port reads and checks its key when called, not in the factory: what the factory throws fails every Command that uses any port, and a missing key for one port must not fail Commands that use another. [`example/ports.ts`](../example/ports.ts) declares three:

```ts
export interface Ports {
  readonly archive: Archive;
  readonly web: Web;
  readonly usage: Usage;
}
```

```ts
export function ports(base: PortsBase): Ports {
  return { archive: waybackArchive(), web: web(base.secret("LINKS_TOKEN")?.value), usage };
}
```

The rules below shape the adapter and the Command around it.

## Failures and their Exit class

Classify by who must act, through a schema over the response, never by its status alone:

- 400, 404, 409, 422 and other refusals of what was sent: `caller`. The message quotes the input that was refused, truncated to about 80 characters with invisible characters escaped (`JSON.stringify` leaves U+2028 and bidi controls raw), and the hint suspects the input before the service.
- A missing key, or one the service rejects (401): `operator`, the hint naming where the key came from (`secret.origin`, never its value, which must not reach an agent's context), or the `.env` to put it in, `envFile` from `ctx` or `PortsBase`.
- No access (403), a lost session, a response whose layout the schema does not know: `source`.
- 5xx, 408, 429, a network failure, a quota: `wait`, with `retryAt` from `Retry-After` or a quota's reset. A 429 that means out of credit is `operator`: someone tops it up. Each provider says which in its own body; an unrecognised 429 stays `wait`.
- A Coding agent's sandbox refuses a host with a proxy `403` carrying `X-Proxy-Error: blocked-by-allowlist`: `operator`, the hint naming the host to allow.

## Polite retries

For a rate-limited API or a scraped site, the adapter retries one request, since it sees the status and `Retry-After`: it sleeps on `PortsBase`'s `clock` and reports each retry through its `progress`. An adapter that classifies a failure throws the `CliError` itself, which the Command passes through unchanged ([`long-runs.md`](long-runs.md) "Wrapping a failure"); one that does not, as [`example/ports.ts`](../example/ports.ts), throws a plain `Error` the Command wraps. Test the retries on the adapter alone, with a fake clock; a Command's tests fake the whole port. The Command owns what spans requests: concurrency, the minimum interval and the breaker.

- Concurrency, minimum interval, retry delays (such as `[1000, 2000, 4000]`) and a breaker threshold are named constants. No flag changes them: politeness is not the caller's choice.
- Retry only `wait`-class failures, and only a request safe to send twice (below): a 502 to a POST that starts a job is `wait`, but it is never resent. When `Retry-After` asks for no longer than the next delay, wait what it asks; when it asks for longer, or the delays run out, throw the `wait` code with `retryAt`. Sleep with the call's signal, so Ctrl-C ends a backoff.
- The breaker trips after a run of consecutive failed requests, counting requests, not attempts, permanent failures included. A tripped breaker stops the queue; items never sent are reported as not attempted, not as failed.

## Work you cannot take back

A request that starts a job or bills may have reached the server although the client saw an error.

- **Resend only what provably did not arrive:** a failure before the connection opened, a GET, a status the provider documents as not billed, or a request the server deduplicates by an id the client generated.
- **An unanswered request is never resent:** a timeout waiting for headers, a socket dropped mid-request, a gateway 502, 504 or 408.
  - When there is a job to fetch, it is still running: a `wait` code with the job id in `details` and a hint naming the command that fetches the result.
  - When there is nothing to fetch (a synchronous billed call), it is an `operator` code: whether to pay again is the operator's call. The hint says it may have been billed.
- **Generate a job's id on the client and `ctx.deliver` it before sending**, so an interrupt or a failure still prints it.
- **After a step that cannot be taken back, every hint names the command that picks up what exists** (a fetch by id, or the run that skips finished outputs), never "run it again", which sends or bills twice. A Command's `deadline.resume` obeys the same rule.

## Deadlines

Metadata lookups need a deadline too ([`long-runs.md`](long-runs.md)).

- **Layer them so the inner one fires first:** the server's limit < the adapter's timeout < the Command's `deadline.ms`, so the server answers and releases its lock before the client gives up. Cap input size so that a timeout can only mean "try again".
- **A deadline stops sending; it never cuts a billed call in flight.** Run a sent paid call inside `ctx.runToEnd`, bounded by `ctx.timeout(ms)` instead of `ctx.signal`: it aborts with `DEADLINE_EXCEEDED` once `ms` have passed, and neither Ctrl-C nor the run `deadline` aborts it. Check `ctx.signal.aborted` before each new call.
  - Its adapter maps that timeout to its own `operator` code, whose hint says the call may have been billed, keeping the timeout as `cause`: a `CliError` is always reported by its own code. From [`example/archive.ts`](../example/archive.ts):

```ts
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
```

## Paid calls

Declare `cost(plan)`, a sentence stating the price, so a run that spends money needs `--yes`, the operator's call:

```ts
cost: (plan) =>
  plan.archive.length === 0
    ? undefined
    : `Archiving ${plan.archive.length} links uses ${plan.archive.length} of the Wayback Machine's daily captures.`,
```

Around it:

- **A choice that decides the bill (a model, a route) has no default.** Without the option or a Project file setting, refuse in `plan` with a `caller` code whose `details` lists each choice and who it bills, so the agent asks its user. The result names who was billed.
- **Refuse every cheap local mistake before the call that bills:** credentials, input, then outputs (`outputs(plan)` does that last one).
- **A batch of paid calls lets every call finish:** cancelling siblings on the first failure discards work already billed. Write each result under a positional name (`<stem>-<i>.<ext>`) so the gaps show, then throw an `AggregateError` of the failures.
- **A result rejected after billing is still written**, and the run then fails. A hint never asks for a rerun to see it, which pays again.
- **Write a provenance record beside each billed output**, `<output>.json`: CLI version, time, command line, model, who was billed, the full prompt, each input's path and sha256, and the options sent. A rerun that finds an output whose record matches skips it, so the rerun fills only the gaps.
- **No silent fallback to another billed route:** the hint names it, and the user chooses.

## Wrapping an SDK

- **The CLI checks shape; the library or server checks meaning.** Refuse ahead of the call only what would fail silently or bill for a discarded result, as a named constant citing its measurement. A copied table of server rules goes stale and refuses valid calls.
- **One repeatable `--option key=value`** (an option typed `z.array(z.string())`) passes an SDK's open-ended options. Report the merged object that was sent, since SDKs drop unknown keys silently, and reject the keys `__proto__`, `constructor` and `prototype`.
- **Classify a dependency's errors by their runtime shape through a schema**, not by its TypeScript types, which drift from what it throws.
- **Audit what the SDK's own retry resends**, and switch off any retry the rules above forbid.

## LLM calls

- The SDK's `maxRetries` is the HTTP retry. A retry for a schema violation is a loop in the adapter outside the SDK call, so an HTTP retry never re-runs an attempt already billed.
- Pass `apiKey` from `ctx.secret`; an SDK that reads `process.env` skips the CLI's `.env`.

## A Side task beside every run

Work that belongs to no Command, such as a usage count, goes in `defineCli({ sideTask })`, never in a Command: a Command cannot count a run a guard refuses, and the process exits once the output is written. The Side task starts once the input is parsed and runs beside the Command, so it adds no time to a fast run. The run waits for it at most `SIDE_TASK_WAIT_MS` (1 s) after the output is written, then aborts its `signal`. What it throws never reaches the caller, so test it through a fake port given to `runCli`, and read its failures under `<NAME>_DEBUG=1`. Return `undefined` to decline, such as for a dry run or an operator who opted out. [`example/cli.ts`](../example/cli.ts):

```ts
  // Counts only real runs, and only for an operator who named a collector.
  sideTask: ({ command, dryRun, env, ports, signal }) => {
    const url = env.LINKS_USAGE_URL;
    return dryRun || url === undefined ? undefined : ports.usage.count(url, command, signal);
  },
```
