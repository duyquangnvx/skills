import type { Archive, Ports, Usage, Web } from "./ports.js";

async function unused(): Promise<never> {
  throw new Error("this test does not expect a call to this port");
}

const unusedArchive: Archive = { capture: unused, status: unused };
const unusedWeb: Web = { status: unused };
const unusedUsage: Usage = { count: unused };

/** Ports that fail when called, with `overrides` in place of the ones a test uses. */
export function fakePorts(overrides: Partial<Ports>): Ports {
  return { archive: unusedArchive, web: unusedWeb, usage: unusedUsage, ...overrides };
}
