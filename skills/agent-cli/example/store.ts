import { join } from "node:path";
import { type CliError, type Context, cliError } from "@duyquangnvx/agent-cli";
import * as z from "zod";
import { errors } from "./errors.js";

export const linkSchema = z.object({
  id: z.number().int(),
  url: z.string(),
  tags: z.array(z.string()),
  snapshot: z.string().optional(),
});

export type Link = z.infer<typeof linkSchema>;

/** A run's files and the folder their paths resolve against. */
export type RunFiles = Pick<Context, "cwd" | "files">;

export const LINKS_FILE = "links.json";

export function linksPath(cwd: string): string {
  return join(cwd, LINKS_FILE);
}

// File content is a boundary: parse it, and turn a bad file into an error the caller can act on.
export async function readLinks(ctx: RunFiles): Promise<Link[]> {
  if (!(await ctx.files.exists(LINKS_FILE))) {
    return [];
  }
  const text = new TextDecoder().decode(await ctx.files.read(LINKS_FILE));
  try {
    return z.array(linkSchema).parse(JSON.parse(text));
  } catch (error) {
    throw cliError(
      errors,
      "CORRUPT_DATA",
      {
        message: `${linksPath(ctx.cwd)} is not valid links data`,
        hint: `fix it or delete it to start with no links`,
      },
      { cause: error },
    );
  }
}

export async function writeLinks(ctx: RunFiles, links: readonly Link[]): Promise<void> {
  await ctx.files.write(LINKS_FILE, `${JSON.stringify(links, null, 2)}\n`);
}

function notFound(id: number): CliError {
  return cliError(errors, "LINK_NOT_FOUND", {
    message: `no link with id ${id}`,
    hint: "run `links list` to see the links and their ids",
  });
}

export async function linkWithId(ctx: RunFiles, id: number): Promise<Link> {
  const link = (await readLinks(ctx)).find((candidate) => candidate.id === id);
  if (link === undefined) {
    throw notFound(id);
  }
  return link;
}
