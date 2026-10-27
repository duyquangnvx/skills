# Shipping: install, the skill beside the CLI, release

The Scaffolder writes the release setup: `install` in `defineCli`, `publishConfig`, `CHANGELOG.md` with its format in its first paragraph, `scripts/release.ts`, and the CLI skill at `skills/<name>/SKILL.md` with its setup reference. These are the decisions it leaves to you.

## How a user installs it

`defineCli({ skill })` names where the CLI's skill comes from, and with it the `skill` row's fix:

- `{ source: "<git URL>" }`, a Skill Hub: the skill arrives apart from the CLI and lives in the user's home, one copy for every project. The Scaffolder's `--skill-hub` sets it.
- `{ packaged: "skills/<name>" }`, a Packaged skill: the skill ships inside the CLI's package, so the copy always matches the CLI that installed it. It needs a CLI with several Commands, and leaves the name `skill` to the Runtime. The Scaffolder's `--dependency` sets it.

### From a Skill Hub

The CLI comes from the registry and its skill from a Skill Hub, so they arrive apart; the skill names the version it describes in `metadata.version`, which each release stamps, and `doctor`'s `skill` row compares every installed copy with the running CLI. The README gives both lines, the skill first, since the agent that loads it can then install the CLI: the skill's `references/setup.md` walks it through installing, checking and updating. The install line is the one fact the skill holds as text, since nothing runs before the CLI is installed. The Scaffolder writes it into the setup reference and the README, and the new CLI's `test/cli.test.ts` fails when either differs from what `doctor` gives as the `install` row's fix, or the README's skill line from the `skill` row's fix. Add to the setup reference what only your CLI needs before its first run, such as a sign-in, a key or a trial run.

- Each release commits the skill to the Skill Hub named as `skillHub` in `scripts/release.ts`, the same git URL as `skill.source` in `defineCli`; `main` of the CLI's own repo may describe what is still unreleased.
- A Coding agent's sandbox denies writes to the skills folders and to the global npm prefix, so the user types both lines, with `!` in Claude Code. `-y` is npx's own: with no terminal to answer on, npx cancels its download question.
- Nothing prints at install or first run: package managers block install scripts, and a first-run line is noise on an agent's stderr.

### A Packaged skill

Choose it when projects pin different versions of the CLI, as with a Dependency install: each project then loads the skill of the version it pins, where one Skill Hub copy in home serves every project, which suits a Global install's one copy per machine.

The CLI comes first, then its Built-in `skill install` copies the skill into the project, so the README gives the CLI's install line, then `<run-as> skill install`, the `skill` row's fix, which the user types with `!` in Claude Code. List `skills` in `package.json` `files`: publishing the package publishes the skill, and each release stamps its `metadata.version` as for a hub. What `skill install` copies, refreshes and writes is in the `skill` JSDoc of `defineCli`.

## Global or Dependency install

The Scaffolder declares a Global install, `install: { mode: "global", package, registry }`: one copy per machine, which the Built-in `update` replaces with the latest release. Choose a Dependency install, `install: { mode: "dependency", package, lockstep? }`, when each project pins the CLI's version as a devDependency, as a CLI does when it shapes the project's own files. The Scaffolder's `--dependency` starts one: `install: { mode: "dependency", package }` with a Packaged skill, every line it writes starting with the run-as, and `publishConfig` and `scripts/release.ts` as for a Global install, since publishing is the same.

- It runs as `npx -q --no-install <bin>`, its run-as: the bin sits in `node_modules/.bin`, off a Coding agent's `PATH`, and `--no-install` keeps npx from fetching another copy. Every line the Runtime builds starts with it, `ctx.commandLine()` included. Text you write is yours to match: start `examples`, hand-written hints and the CLI skill's lines with the run-as too.
- The Runtime adds no `update`: the project's package manager moves the version, so the name stays free for a Command of the CLI's own.
- It declares no registry: `doctor` runs npm at the project root, the nearest folder with a lockfile, so the project's `.npmrc` names the registry and its token.
- List under `lockstep` the packages released at the CLI's version, such as a kit its Commands write code against, so `doctor`'s fix moves them together.
- Declare a Packaged skill, so the skill a project loads matches the version it pins.
- The README and the setup reference give the project's add line, `pnpm add -D <package> <lockstep…>`, then `<run-as> skill install`. The scaffolded test compares the add line with `doctor`'s `install` fix, which that row gives only in a project that neither installs nor lists the CLI, so the test runs `doctor` from a temporary one.
- With no copy installed, npx refuses before the CLI starts, so `doctor` cannot guide a fresh checkout: the setup reference says to run the project's install when a `package.json` lists the package, else the add line.

## Release

Log each change a caller would notice under `## Unreleased` in `CHANGELOG.md` as it merges. To release, bump `version` in `package.json` and run `pnpm release`, which says what to commit.

`update` shows the user each release between the version they leave and the one installed, oldest first. A CLI with local state, a daemon or an extension has releases that ask something of the user, such as a fetch after a store rebuild, and those steps get lost among the other entries. So a release that lists them under the `### Upgrade from` heading the CHANGELOG's first paragraph asks for shows only those steps, and nothing when they read `Nothing to do.`; a release without the heading shows its whole section.

## The CLI's own skill

- **`--help` describes the tool; the skill describes the agent's work around it:** when to use the CLI, workflows naming Commands in order, and what to do for each error code that needs judgement beyond its hint. It names a flag only when a workflow needs one.
- **Its Recovering from errors table stays in `SKILL.md`**, in context when a run fails; the CLI's own codes come before the exit rows, since the agent matches the first row that fits.
- **Check it with a fresh subagent** given only the skill's path and a real task. Cut a sentence for a failure whose hint already says what to do.

## An `AGENTS.md` block

A CLI owns one `<!-- BEGIN:<name> -->`…`<!-- END:<name> -->` block in the repo's `AGENTS.md`, rewritten between its markers and leaving the rest as it was. Claude Code reads `AGENTS.md` only through an `@AGENTS.md` line in `CLAUDE.md`, so whatever writes the block names that line as a hand edit; no CLI edits `CLAUDE.md`.

- A Packaged skill's `skill install` writes the block for you.
- Otherwise the block holds only a rule for work done without calling the CLI (such as how to name what it later finds by name), written by a Command of the CLI's own; how to use the CLI is the skill's.

## What to build next

Give an agent realistic multi-step tasks whose outcome a check can verify, count its `--help` reads, retries after a usage error and spilled outputs, and read the transcripts: every call to the CLI, and every workaround around it (a hand-written loop, a measurement with another tool), is a candidate Command or field. The CLI does the mechanical work; judgement stays with the agent. Prefer a documented shell pattern over a `batch` Command until a second caller writes its own runner, and report in data the measurement the caller's next step checks, with the same threshold as the tool it replaces.
