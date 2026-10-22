# `doctor` rows

Every multi-Command CLI has a built-in `doctor` that reports one row per check: `build`, `node`, the CLI's own rows, one per declared tool, `install`, `registry` and `skill`. Declare a tool the whole CLI relies on in `defineCli({ tools: [...] })` so `doctor` checks it without attaching it to one Command; no Command refuses for it unless it lists the tool in its own `tools`. Add a row for each outside system the CLI depends on, in `defineCli({ doctor: [...] })`, probing it through the port method a Command calls rather than a health endpoint, so a green row means the Command's own request works:

```ts
const store: DoctorCheck<Ports, Settings> = {
  name: "store",
  run: async (ctx) => {
    const links = await readLinks(ctx);
    return { state: "ok", message: `${linksPath(ctx.cwd)} holds ${links.length} links` };
  },
};
```

A row reads the project's settings as `ctx.project`, `undefined` when there is no Project file, as a Command does. When the file is unusable, reading `ctx.project` skips the row, since the `project` row already reports the file, so a row needs no branch for it:

```ts
const tag: DoctorCheck<Ports, Settings> = {
  name: "tag",
  run: (ctx) => {
    const tag = ctx.project?.settings.tag;
    return {
      state: "ok",
      message:
        tag === undefined
          ? "`links add` leaves a link untagged unless given --tag"
          : `\`links add\` tags a link ${tag} unless given --tag`,
    };
  },
};
```

A row returns one of:

- `{ state: "ok", message, fix? }`;
- `{ state: "problem", message, fix?, code? }`, where `fix` is the command that fixes the problem and `code` is one of the Error table's or the Runtime's;
- `{ state: "skipped", message }` for a row not checked, such as "not checked: the bridge is down", so one cause shows up as one problem. It never fails `doctor`.

When any row is a problem, `doctor` fails with one error per problem row, its `code` or `DOCTOR_PROBLEMS` (exit 2) without one, so it exits by the class that must act first as any Command does: an expired session 3, a network failure 75. Give a problem the code of its real cause. A row that throws becomes its own problem, with a `CliError`'s message and hint as the message and its code as `code`. Each row runs under its own deadline, 10 s unless it sets `deadlineMs`, and `ctx.signal` aborts at that deadline, so pass it on. A row with `advisory: true` shows its problem and `fix` but never fails `doctor`:

```ts
name: "token",
advisory: true,
run: (ctx) => {
  const secret = ctx.secret("LINKS_TOKEN");
  if (secret === undefined) {
    return {
      state: "problem",
      message: "LINKS_TOKEN is not set; `links check` sends no token",
      fix: `add LINKS_TOKEN=<token> to ${ctx.envFile}`,
    };
  }
  const where = secret.origin.kind === "env" ? "the environment" : secret.origin.path;
  return { state: "ok", message: `LINKS_TOKEN is set in ${where}` };
},
```

The `install` and `registry` rows follow `defineCli({ install })`, and are `skipped` without it. Both are advisory: a project may stay on an older release on purpose.

- **Global install:** `install` checks that the CLI runs from npm's global folder, else gives the global install line; `registry` compares the build with the registry's latest and gives `<cli> update`.
- **Dependency install:** `install` checks that the copy that runs is the one the project at the working directory installed. It is `skipped` with `registry` when the CLI runs from source or the project links the package from its workspace, which decides its version. Otherwise a project without the package gets its package manager's add line, a copy whose `package.json` is unreadable gets its install line, and another copy than the project's gets `pnpm exec <cli>` or `npx <cli>`. `registry` compares the build with the latest release npm finds from the project root and gives `pnpm up --latest …` or `npm install …@latest`, naming the `lockstep` packages; for yarn and bun it names the version to move to instead.

The `skill` row's fix installs the CLI's skill from `defineCli({ skill: { source } })`, the Skill Hub its release commits the skill to; without it the row gives `skills update` for an older copy and nothing to install a missing one.
