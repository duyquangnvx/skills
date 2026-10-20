import type { PortsBase } from "@duyquangnvx/agent-cli";
import * as z from "zod";

export type Capture =
  | { readonly state: "pending" }
  | { readonly state: "done"; readonly snapshot: string }
  | { readonly state: "failed"; readonly reason: string };

/** The Wayback Machine's capture service; a test replaces it through `runCli`'s `ports`. */
export interface Archive {
  /** Starts capturing `url` and returns the capture's job id. */
  capture(url: string, signal: AbortSignal): Promise<string>;
  status(job: string, signal: AbortSignal): Promise<Capture>;
}

/** The web the saved links live on. */
export interface Web {
  /** The HTTP status `url` answers a HEAD request with. */
  status(url: string, signal: AbortSignal): Promise<number>;
}

/** The operator's own collector of usage counts, which `LINKS_USAGE_URL` names. */
export interface Usage {
  /** Counts one run of the Command at `command`. */
  count(url: string, command: readonly string[], signal: AbortSignal): Promise<void>;
}

export interface Ports {
  readonly archive: Archive;
  readonly web: Web;
  readonly usage: Usage;
}

const WAYBACK = "https://web.archive.org";

const jobSchema = z.object({ job_id: z.string() });

const statusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("success"), timestamp: z.string(), original_url: z.string() }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);

async function json(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${response.url} answered ${response.status}`);
  }
  return response.json();
}

function waybackArchive(): Archive {
  return {
    capture: async (url, signal) => {
      const response = await fetch(`${WAYBACK}/save`, {
        method: "POST",
        headers: { accept: "application/json" },
        body: new URLSearchParams({ url }),
        signal,
      });
      return jobSchema.parse(await json(response)).job_id;
    },
    status: async (job, signal) => {
      const response = await fetch(`${WAYBACK}/save/status/${job}`, {
        headers: { accept: "application/json" },
        signal,
      });
      const status = statusSchema.parse(await json(response));
      switch (status.status) {
        case "pending":
          return { state: "pending" };
        case "success":
          return {
            state: "done",
            snapshot: `${WAYBACK}/web/${status.timestamp}/${status.original_url}`,
          };
        case "error":
          return { state: "failed", reason: status.message };
      }
    },
  };
}

function web(token: string | undefined): Web {
  const headers: Record<string, string> =
    token === undefined ? {} : { authorization: `Bearer ${token}` };
  return {
    status: async (url, signal) => (await fetch(url, { method: "HEAD", headers, signal })).status,
  };
}

const usage: Usage = {
  count: async (url, command, signal) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: command.join(" ") }),
      signal,
    });
    if (!response.ok) {
      throw new Error(`${url} answered ${response.status}`);
    }
  },
};

export function ports(base: PortsBase): Ports {
  return { archive: waybackArchive(), web: web(base.secret("LINKS_TOKEN")?.value), usage };
}
