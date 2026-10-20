import { cliError, type DoctorCheck, paginate } from "@duyquangnvx/agent-cli";
import * as z from "zod";
import { archive } from "./archive.js";
import { bundle } from "./bundle.js";
import { commit } from "./commit.js";
import { defineCli, defineCommand, projectFile, type Settings } from "./define.js";
import { errors } from "./errors.js";
import { exportLinks } from "./export.js";
import { importLinks } from "./import.js";
import { type Ports, ports } from "./ports.js";
import { serve } from "./serve.js";
import { linkSchema, linksPath, linkWithId, readLinks, writeLinks } from "./store.js";

const list = defineCommand({
  name: "list",
  description: "List saved links",
  examples: [
    { command: "links list", note: "show every link with its id" },
    { command: "links list --tag docs", note: "show only the links tagged docs" },
    { command: "links list --fields id,url --json", note: "get only each link's id and url" },
  ],
  effect: "read",
  options: z.object({
    tag: z.string().optional().describe("only show links with this tag"),
  }),
  rows: linkSchema,
  run: async ({ tag, limit, cursor }, ctx) => {
    const links = await readLinks(ctx);
    const matching = tag === undefined ? links : links.filter((link) => link.tags.includes(tag));
    return paginate(matching, { limit, cursor });
  },
  render: (page, style) =>
    page.items.length === 0
      ? "No links."
      : page.items.map((link) => `${style.dim(String(link.id))}  ${link.url}`).join("\n"),
});

const add = defineCommand({
  name: "add",
  description: "Save a link",
  examples: [
    { command: "links add https://zod.dev --tag docs", note: "save a link tagged docs" },
    { command: "links add https://zod.dev --dry-run", note: "show the link it would save" },
  ],
  effect: "write",
  args: z.object({
    url: z.url().describe("the address to save"),
  }),
  options: z.object({
    tag: z
      .string()
      .optional()
      .describe("tag the link with this, in place of the Project file's tag"),
  }),
  output: linkSchema,
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
});

const remove = defineCommand({
  name: "remove",
  description: "Delete a saved link",
  examples: [
    { command: "links remove 3 --dry-run", note: "show the link it would delete" },
    {
      command: "links remove 3 --confirm https://zod.dev",
      note: "delete link 3, confirmed by its url",
    },
  ],
  effect: "destructive",
  args: z.object({
    id: z.number().int().describe("the link's id, as `links list` shows it"),
  }),
  output: linkSchema,
  plan: async ({ id }, ctx) => ({ remove: await linkWithId(ctx, id) }),
  confirm: (plan) => plan.remove.url,
  apply: async (plan, ctx) => {
    const links = await readLinks(ctx);
    await ctx.runToEnd("saving the links", () =>
      writeLinks(
        ctx,
        links.filter((link) => link.id !== plan.remove.id),
      ),
    );
    return plan.remove;
  },
  render: (link) => `Deleted link ${link.id}: ${link.url}`,
  renderPlan: (plan) => `Would delete link ${plan.remove.id}: ${plan.remove.url}`,
});

const DEFAULT_TIMEOUT_MS = 5000;

const check = defineCommand({
  name: "check",
  description: "Check that a saved link still answers",
  examples: [
    { command: "links check 3", note: "print the HTTP status link 3 answers with" },
    { command: "links check 3 --timeout 1000", note: "give up after 1 second" },
  ],
  effect: "read",
  args: z.object({
    id: z.number().int().describe("the link's id, as `links list` shows it"),
  }),
  options: z.object({
    timeout: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_TIMEOUT_MS)
      .describe("milliseconds to wait for an answer"),
  }),
  output: z.object({ id: z.number(), url: z.string(), status: z.number() }),
  run: async ({ id, timeout }, ctx) => {
    const link = await linkWithId(ctx, id);
    const signal = ctx.deadline(timeout);
    try {
      return { id, url: link.url, status: await ctx.ports.web.status(link.url, signal) };
    } catch (error) {
      // An interrupt or a missed deadline already carries the right error.
      if (signal.aborted) {
        throw signal.reason;
      }
      throw cliError(
        errors,
        "UNREACHABLE",
        {
          message: `${link.url} did not answer`,
          hint: `check the address, then run \`links check ${id}\` again`,
        },
        { cause: error },
      );
    }
  },
  render: ({ url, status }) => `${url} answered ${status}`,
});

const store: DoctorCheck<Ports, Settings> = {
  name: "store",
  run: async (ctx) => {
    const links = await readLinks(ctx);
    return { state: "ok", message: `${linksPath(ctx.cwd)} holds ${links.length} links` };
  },
};

// Names where the token came from, never its value, so the key does not reach an agent's context.
const token: DoctorCheck<Ports, Settings> = {
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
};

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

export const cli = defineCli({
  name: "links",
  version: "1.0.0",
  description: "Keep a list of links and check that they still resolve.",
  errors,
  ports,
  project: projectFile,
  // Counts only real runs, and only for an operator who named a collector.
  sideTask: ({ command, dryRun, env, ports, signal }) => {
    const url = env.LINKS_USAGE_URL;
    return dryRun || url === undefined ? undefined : ports.usage.count(url, command, signal);
  },
  commands: {
    list,
    add,
    import: importLinks,
    remove,
    check,
    archive,
    export: exportLinks,
    bundle,
    commit,
    serve,
  },
  doctor: [store, tag, token],
});
