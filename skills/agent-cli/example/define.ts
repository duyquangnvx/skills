import { agentCli } from "@duyquangnvx/agent-cli";
import * as z from "zod";
import type { Ports } from "./ports.js";

export const projectFile = {
  file: "links.config.json",
  schema: z.object({
    tag: z.string().optional().describe("the tag `links add` gives a link saved without --tag"),
  }),
};

export type Settings = z.infer<typeof projectFile.schema>;

export const { defineCli, defineCommand } = agentCli<Ports, Settings>();
