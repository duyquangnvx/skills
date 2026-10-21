---
name: agent-cli
description: >-
  Builds CLIs on `@duyquangnvx/agent-cli`, the Runtime for Agent CLIs. Use when starting a CLI, adding or changing a Command or `doctor` row of a CLI built on it, or testing one.
metadata:
  version: "0.10.0"
---

# agent-cli

An Agent CLI is a command-line tool whose main caller is a Coding agent running it through a shell. The Runtime, `@duyquangnvx/agent-cli`, owns parsing, help, output, errors and exit codes, so every Agent CLI keeps the Output contract: stdout carries only a Command's data, stderr only errors and progress, and the exit code is 0 or the failure's Exit class, who must act (see [Errors](#errors)). Your code declares Commands; the Runtime does the rest.

This skill teaches what a type cannot show. The API reference is the JSDoc in `node_modules/@duyquangnvx/agent-cli/dist/index.d.ts` and the files it re-exports: read it for any field, option or method this skill does not spell out.

[`example/`](example/) is a complete Agent CLI, `links`, that uses every feature this skill covers, and its `*.test.ts` files test it. Every TypeScript block in this skill is an excerpt of it.

## Runtime version

Compare `@duyquangnvx/agent-cli` in the CLI's `package.json` with 0.10.0, the version this skill describes. If they differ, tell the user before going on: an API below may have changed.

## Start a repo

```sh
pnpm create @duyquangnvx/agent-cli <name> --description "One line saying what it does" --skill-hub https://github.com/<owner>/skills.git
```

The Scaffolder creates `./<name>`, a working Agent CLI whose example Commands you replace; run it with `--dry-run` first to list every file it would write. Keep the `version`, `description`, `build`, `install` and `engines` lines of its `defineCli`: help, `--version`, `doctor` and `update` read them. `description` is package.json's, which `--description` set: the one line root help and `--help --json` give for what the CLI does. `--skill-hub` names the git URL of the Skill Hub each release commits the CLI skill to: it becomes `skill.source` in `defineCli`, `skillHub` in `scripts/release.ts` and the skill's install line in the README. The repo is started when the Skill Hub is set, the examples (`greet`, `card` and `LANGUAGE_UNSUPPORTED`) are gone from code, tests and `skills/<name>/SKILL.md`, every real Command is [done](#a-command-is-done-when), and that skill is rewritten around the real Commands as its comments say.

## Commands

Call `agentCli<Ports, Settings>()` once and share the `defineCommand` and `defineCli` it returns, as [`example/define.ts`](example/define.ts) does; `Settings` types the Project file the CLI declares in `defineCli({ project })`, which `doctor` reports in its `project` row. List each Command in `defineCli({ commands })` under the word the caller types; nest objects for groups (`commands: { voices: { list } }` gives `tool voices list`). A Command returns data and never prints:

- `description`, one line, and `examples` with realistic full command lines: help and `--help --json` lead with them. Put what one line cannot hold, such as the Command's error codes and output shape, in `help`.
- `.describe()` on every field of `args` and `options`: the descriptions become help.
- `output`, the schema of the data, so `--help --json` publishes it. A List Command declares `rows` instead, below.
- The data names things the way the next call needs them: an id the next Command takes beside a name a person recognises, and a file by its absolute path (`resolve(ctx.cwd, file)`), since the caller's next shell may start in another folder.
- `render` turns the data into short text. Its `style` is for emphasis, never for meaning, since it colours only for a person at a terminal.

Rarer cases, each documented in the types:

- `orStdin` on an arg, for text too long or too quoted for one shell word, as `links import` takes it. A pipe that sends nothing for 30 s (`STDIN_IDLE_MS`) fails the run with `STDIN_STALLED`, exit 1, before the Command runs; a terminal waits as long as the person types.
- A `z.array(...)` arg or option, for repeated values.
- `operator: true`, for a step only a person at a terminal can take, such as a sign-in through the browser.
- `hidden: true`, for a Command the CLI runs on itself, such as a daemon ([`references/local-state.md`](references/local-state.md)).

Data over 30,000 characters is spilled: the Runtime writes it to a file under `$TMPDIR` and stdout carries the file, its size and its first 2,000 characters, so one call cannot flood the agent's context. A List Command never spills; `--limit` sizes it.

Read the working directory and environment from `ctx`, so tests control them. Reach the file system through `ctx.files`, whose failures name the path; a `node:fs` failure is a bug (exit 70). Pass `mode` to its `write` or `mkdir` for a file or folder holding tokens. Catch an exported file code to say what to do instead, as [`example/bundle.ts`](example/bundle.ts) turns `ALREADY_EXISTS` into its own `BUNDLE_EXISTS`. Run a program through `ctx.spawn` and list it in the Command's `tools`, so a missing one fails before any work and `doctor` checks it. Call `ctx.progress` while a long step runs, since a Coding agent may kill a CLI that stays silent.

## Effects and Plans

Name Commands so their leading words separate reads from changes (`links list`, `links remove`): a Coding agent's permission rules match command-line prefixes, so the operator can allow every read and still be asked about each change. A read Command takes no flag that changes anything. A write Command is safe to run again: a second run after a success changes nothing, as `links archive` skips links already archived.

A `read` Command has `run(input, ctx)`. A `write` or `destructive` Command splits the work in two, and the Runtime adds `--dry-run`, which prints the Plan and stops:

```ts
plan: async ({ url, tag }, ctx) => {
  const links = await readLinks(ctx);
  const id = Math.max(0, ...links.map((link) => link.id)) + 1;
  const tags = [tag ?? ctx.project?.settings.tag].filter((name) => name !== undefined);
  return { add: { id, url, tags } };
},
apply: async (plan, ctx) => {
  const links = await readLinks(ctx);
  await ctx.runToEnd("saving the links", () => writeLinks(ctx, [...links, plan.add]));
  return plan.add;
},
render: (link) => `Saved link ${link.id}: ${link.url}`,
renderPlan: (plan) => `Would save link ${plan.add.id}: ${plan.add.url}`,
```

`plan` reads and validates only: every side effect lives in `apply`, so a dry run is always safe. Keep the Plan to paths, hashes and numbers and produce bytes in `apply`.

A Command that writes files declares `outputs(plan)`, which earns it `--force` and refuses to replace an existing output without it. Write them in `apply` through `ctx.files` or a port's `files`. Refuse an output that is also an input by comparing `ctx.files.stat` ids; `--force` never covers that.

```ts
outputs: (plan) => [plan.file],
apply: async (plan, ctx) => {
  await ctx.files.write(plan.file, markdownOf(plan.links));
  return { file: resolve(ctx.cwd, plan.file), count: plan.links.length };
},
```

A `destructive` Command has `confirm(plan)`, the value the caller repeats as `--confirm`. Pick something the caller can see in the Plan, such as a name or URL:

```ts
confirm: (plan) => plan.remove.url,
```

When what `--force` replaces is not a list of files, such as a whole folder, declare `force` with a sentence saying what it replaces, and make the Plan say it too. A Plan that costs money declares `cost` (Paid calls in [`references/remote-services.md`](references/remote-services.md)). A `serve` Command keeps running, such as a preview server ([`references/long-runs.md`](references/long-runs.md)).

## Errors

Declare every error code the CLI throws once, in its Error table: `defineErrors`, passed to `defineCli({ errors })`. Each code has the Exit class that must act on it (`caller`, `operator`, `source` or `wait`) and, optionally, a Zod schema for its `details`, the facts an agent acts on without parsing the message:

```ts
export const errors = defineErrors({
  LINK_NOT_FOUND: { class: "caller" },
  CORRUPT_DATA: { class: "caller" },
  BUNDLE_EXISTS: { class: "caller" },
  UNREACHABLE: { class: "source" },
  ARCHIVE_FAILED: {
    class: "source",
    details: z.object({ id: z.number(), url: z.string() }),
  },
  CAPTURE_UNANSWERED: {
    class: "operator",
    details: z.object({ id: z.number(), url: z.string() }),
  },
});
```

Throw through `cliError`. The `hint` names the next command to run, and says whether running it again can help. Set `retryAt` only when the source said when to come back:

```ts
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
```

The exit code is the failure's Exit class: 1 the caller, 2 the operator, 3 someone at the source, 75 nobody but time (wait, then run again), 70 a bug, 130 or 143 an interrupt by SIGINT or SIGTERM. A `UsageError` exits 1, for input your schemas could not reject: give it the code `INVALID_INPUT`. A code missing from the table, and anything else thrown, is a bug, unless it keeps a deadline's abort as `cause` (Wrapping a failure in [`references/long-runs.md`](references/long-runs.md)): exit 70, with a hint to rerun under `<NAME>_DEBUG=1` for the stack trace and its `cause` chain, and to report it at package.json's `bugs` when declared. Under `--json`, stderr is JSON Lines: every progress line is `{"progress":"..."}`, and the last line is `{ errors: [{ code, message, hint, details?, retryAt? }] }`, even for one error.

Every Runtime code is exported under its name, such as `OUTPUT_EXISTS` or `TOOL_FAILED`: catch, return and assert codes through these constants, never as strings. A Command throws a Runtime code only where it means what the Runtime means by it: `INVALID_INPUT`, a file code from `ctx.fileError`, `TOOL_MISSING` or `TOOL_FAILED`. The others, such as `UNKNOWN_COMMAND` or `DOCTOR_PROBLEMS`, name the Runtime's own checks, so a Command only catches or asserts them.

To report every problem a run found, throw an `AggregateError` of them, nested to group them if you like: each leaf prints with its hint, and the run exits with the first of 1, 2, 3, 75 that any of them has, or 70 when any is not a known `CliError`.

```ts
if (failures.length > 0) {
  throw new AggregateError(failures, `${failures.length} links were not archived`);
}
```

Parse files, responses and other outside input with a Zod schema and turn a failure into a `CliError` with a fix in its hint, as [`example/store.ts`](example/store.ts) does for a corrupt data file.

## Lists: pagination and `--fields`

A Command that lists many items is a List Command: a read Command that declares the schema of one row as `rows` in place of `output`. The Runtime adds `--limit`, `--cursor` and `--fields`, and each page names the command line for the next. A list held whole in memory returns `paginate(items, { limit, cursor })`:

```ts
options: z.object({
  tag: z.string().optional().describe("only show links with this tag"),
}),
rows: linkSchema,
run: async ({ tag, limit, cursor }, ctx) => {
  const links = await readLinks(ctx);
  const matching = tag === undefined ? links : links.filter((link) => link.tags.includes(tag));
  return paginate(matching, { limit, cursor });
},
```

A source that pages itself, such as a remote API, returns `page(items, next)`, where `next` is the source's own cursor for the following page: ask the source for `limit` items from `cursor`, and pass its cursor through unchanged.

## A Command is done when

- Every code it throws is in the Error table.
- Each hint names the next command to run.
- It declares `output` or `rows`.
- It has `examples` with realistic full command lines.
- Every field has `.describe()`.
- `ctx.signal` reaches every outside call.
- Every call to a slow outside system runs under a deadline.
- Its tests, through `runCli`, cover:
  - the success output, in text and under `--json`;
  - each `CliError` code;
  - for a write or destructive Command, that `--dry-run` and each refused guard change nothing;
  - cancellation by passing `signal` to `runCli`, aborted once with the reason `"SIGTERM"` for 143;
  - for a `serve` Command, aborting `signal` once the server answers;
  - each `doctor` row it adds, with `HOME` pointed at an empty directory so no installed skill or secret leaks in.
- The CLI's `pnpm test`, `pnpm typecheck` and `pnpm lint` pass.

The example's tests have each of these.

## References

- [`references/long-runs.md`](references/long-runs.md): a Command that calls a slow outside system, polls, could outlast the caller's tool timeout, starts a job to check on later, has a step that must not stop halfway, works through a queue, reports progress, keeps running as a server, or must keep finished work when it fails.
- [`references/remote-services.md`](references/remote-services.md): a port to a remote service: declaring ports, classifying failures, retrying, a request that starts a job or bills, a cost the operator approves, an SDK or LLM call, a Side task such as a usage count beside every run.
- [`references/local-state.md`](references/local-state.md): a daemon or a store that outlives a run.
- [`references/shipping.md`](references/shipping.md): publishing the CLI, its install lines, its own skill or an `AGENTS.md` block.
- [`references/doctor.md`](references/doctor.md): adding a `doctor` row, or a tool the whole CLI relies on.
- [`references/testing.md`](references/testing.md): writing a test, faking a port, the clock, files, a child process or a tool.
