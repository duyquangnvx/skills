import { orStdin } from "@duyquangnvx/agent-cli";
import * as z from "zod";
import { defineCommand } from "./define.js";
import { linkSchema, readLinks, writeLinks } from "./store.js";

// Ends on a character that cannot close a sentence, so "see https://zod.dev." keeps no dot.
const URL_PATTERN = /https?:\/\/[^\s<>()[\]"'`]*[^\s<>()[\]"'`.,;:!?]/g;

export const importLinks = defineCommand({
  name: "import",
  description: "Save every link found in a text, such as a Markdown file",
  help:
    "Give - to read the text from stdin, so a file of any length or quoting goes in whole: " +
    "`links import - < notes.md`. Links already saved are skipped.",
  examples: [
    { command: "links import - < notes.md", note: "save every link in notes.md" },
    {
      command: "links import 'see https://zod.dev' --tag docs --tag zod",
      note: "save one link with two tags",
    },
  ],
  effect: "write",
  args: z.object({
    text: orStdin(z.string().min(1)).describe("the text holding the links; - reads it from stdin"),
  }),
  options: z.object({
    tag: z
      .array(z.string())
      .default([])
      .describe("tag each saved link with this; repeat for more tags"),
  }),
  output: z.array(linkSchema),
  plan: async ({ text, tag }, ctx) => {
    const links = await readLinks(ctx);
    const saved = new Set(links.map((link) => link.url));
    const urls = [...new Set(text.match(URL_PATTERN))].filter((url) => !saved.has(url));
    const firstId = Math.max(0, ...links.map((link) => link.id)) + 1;
    return { add: urls.map((url, index) => ({ id: firstId + index, url, tags: tag })) };
  },
  apply: async (plan, ctx) => {
    const links = await readLinks(ctx);
    await ctx.runToEnd("saving the links", () => writeLinks(ctx, [...links, ...plan.add]));
    return plan.add;
  },
  render: (added) =>
    added.length === 0
      ? "No new links."
      : added.map((link) => `Saved link ${link.id}: ${link.url}`).join("\n"),
  renderPlan: (plan) => `Would save ${plan.add.length} links`,
});
