# Testing through `runCli`

What to cover is the done list in [`SKILL.md`](../SKILL.md). Test what a Coding agent sees: drive the CLI in-process with `runCli(cli, argv, { env, cwd })` and assert on `stdout`, `stderr` and `exitCode`. Give each test its own temporary `cwd` and an explicit `env`:

```ts
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
```

Assert a failure's code through the exported constant, so a misspelt code fails type checking:

```ts
expect(JSON.parse(result.stderr)).toMatchObject({ errors: [{ code: PROJECT_INVALID }] });
```

## Fakes

A test without `ports` builds the real ones and reaches the real service. Fake each port with a plain object that answers the way the case needs, and build the test's ports through one function that fills every other port with one failing when called, as [`example/fake-ports.ts`](../example/fake-ports.ts) does, so a new port changes that function rather than every test:

```ts
export function fakePorts(overrides: Partial<Ports>): Ports {
  return { archive: unusedArchive, web: unusedWeb, usage: unusedUsage, ...overrides };
}
```

Pass the clock from [`example/fake-clock.ts`](../example/fake-clock.ts) (copy it into the CLI's tests): its time moves only when every task waits on it, so polls and a four-minute run deadline finish at once and in order.

```ts
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
```

A Command that awaits native threads, such as sharp's, runs work the clock cannot see, so the run deadline fires mid-call: pass `fakeClock(busy)` with a `busy()` that is true while such a call is in flight.

- `files`: replace it to make a read or write fail. A fake implements all seven methods, as `fakeFiles` in [`example/folder.ts`](../example/folder.ts) does.
- `spawn`: replace it to answer for a child process. It receives an `onLine` callback when the caller passed `progress: true`; call it to emit the child's lines.
- `tools`: put a folder holding an empty executable of that name on the test's `PATH`.
- `stdin`: pass the text an `orStdin` arg reads as `runCli`'s `stdin` option.

## What the Runtime already tests

`--help`, `--help --json`, `--version`, `--json`, `--dry-run`, `--confirm`, `--force`, `--yes`, `--limit`, `--cursor`, `--fields`, spilling, `doctor` and `update` come from the Runtime, which tests them; test only what your definitions decide, such as the `output` schema `--help --json` shows.
