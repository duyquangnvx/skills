import { resolve } from "node:path";
import * as z from "zod";
import { defineCommand } from "./define.js";
import { type Link, readLinks } from "./store.js";

function markdownOf(links: readonly Link[]): string {
  return links
    .map((link) => `- <${link.url}>${link.tags.length === 0 ? "" : ` (${link.tags.join(", ")})`}\n`)
    .join("");
}

export const exportLinks = defineCommand({
  name: "export",
  description: "Write the links to a Markdown file",
  examples: [
    { command: "links export LINKS.md", note: "write every link to LINKS.md" },
    { command: "links export LINKS.md --force", note: "replace an existing LINKS.md" },
  ],
  effect: "write",
  args: z.object({
    file: z.string().describe("the Markdown file to write, relative to the working directory"),
  }),
  output: z.object({ file: z.string(), count: z.number() }),
  plan: async ({ file }, ctx) => ({ file, links: await readLinks(ctx) }),
  outputs: (plan) => [plan.file],
  apply: async (plan, ctx) => {
    await ctx.files.write(plan.file, markdownOf(plan.links));
    return { file: resolve(ctx.cwd, plan.file), count: plan.links.length };
  },
  render: ({ file, count }) => `Exported ${count} links to ${file}`,
  renderPlan: (plan) => `Would export ${plan.links.length} links to ${plan.file}`,
});
