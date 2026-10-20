import { resolve } from "node:path";
import { ALREADY_EXISTS, CliError, cliError } from "@duyquangnvx/agent-cli";
import * as z from "zod";
import { defineCommand } from "./define.js";
import { errors } from "./errors.js";
import { type Link, linkWithId } from "./store.js";

function shortcutOf(link: Link): string {
  return `[InternetShortcut]\r\nURL=${link.url}\r\n`;
}

export const bundle = defineCommand({
  name: "bundle",
  description: "Write links as shortcut files into a new folder",
  examples: [
    { command: "links bundle docs 1 2", note: "write links 1 and 2 to docs/1.url and docs/2.url" },
    { command: "links bundle docs 1 --force", note: "replace an existing docs folder" },
  ],
  effect: "write",
  force: "an existing folder, removing everything in it",
  args: z.object({
    folder: z.string().describe("the folder to create, relative to the working directory"),
    ids: z.array(z.number().int()).min(1).describe("the links' ids, as `links list` shows them"),
  }),
  output: z.object({ folder: z.string(), files: z.array(z.string()) }),
  plan: async ({ folder, ids }, ctx) => ({
    folder,
    links: await Promise.all(ids.map((id) => linkWithId(ctx, id))),
    remove: ctx.force && (await ctx.files.exists(folder)) ? await ctx.files.list(folder) : [],
  }),
  apply: async (plan, ctx) => {
    if (ctx.force) {
      await ctx.files.remove(plan.folder);
    }
    try {
      await ctx.files.mkdir(plan.folder, { exclusive: true });
    } catch (error) {
      if (error instanceof CliError && error.code === ALREADY_EXISTS) {
        const ids = plan.links.map((link) => link.id).join(" ");
        throw cliError(errors, "BUNDLE_EXISTS", {
          message: `${plan.folder} already exists`,
          hint: `to replace it and everything in it, run \`links bundle ${plan.folder} ${ids} --force\``,
        });
      }
      throw error;
    }
    const files = plan.links.map((link) => `${link.id}.url`);
    for (const link of plan.links) {
      await ctx.files.write(`${plan.folder}/${link.id}.url`, shortcutOf(link));
    }
    return { folder: resolve(ctx.cwd, plan.folder), files };
  },
  render: ({ folder, files }) => `Bundled ${files.length} links into ${folder}`,
  renderPlan: (plan) =>
    `Would bundle ${plan.links.length} links into ${plan.folder}` +
    (plan.remove.length === 0 ? "" : `, removing ${plan.remove.join(", ")}`),
});
