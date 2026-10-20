import * as z from "zod";
import { defineCommand } from "./define.js";
import { LINKS_FILE } from "./store.js";

export const commit = defineCommand({
  name: "commit",
  description: "Commit links.json to the git repository it is in",
  examples: [
    { command: "links commit", note: "commit links.json with the message Update links" },
    { command: 'links commit --message "Add the zod docs"', note: "commit with your message" },
  ],
  effect: "write",
  tools: [{ name: "git", install: "brew install git" }],
  options: z.object({
    message: z.string().default("Update links").describe("the commit message"),
  }),
  output: z.object({ commit: z.string() }),
  plan: ({ message }) => ({ message }),
  apply: async ({ message }, ctx) => {
    await ctx.spawn("git", ["add", LINKS_FILE], { check: true });
    await ctx.spawn("git", ["commit", "--message", message], { check: true });
    const head = await ctx.spawn("git", ["rev-parse", "--short", "HEAD"], { check: true });
    return { commit: head.stdout.trim() };
  },
  render: ({ commit }) => `Committed ${LINKS_FILE} as ${commit}`,
  renderPlan: ({ message }) => `Would commit ${LINKS_FILE} with the message "${message}"`,
});
