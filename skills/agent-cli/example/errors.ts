import { defineErrors } from "@duyquangnvx/agent-cli";
import * as z from "zod";

export const errors = defineErrors({
  LINK_NOT_FOUND: { class: "caller" },
  CORRUPT_DATA: { class: "caller" },
  BUNDLE_EXISTS: { class: "caller" },
  UNREACHABLE: { class: "source" },
  ARCHIVE_FAILED: {
    class: "source",
    details: z.object({ id: z.number(), url: z.string() }),
  },
  CAPTURE_UNANSWERED: {
    class: "operator",
    details: z.object({ id: z.number(), url: z.string() }),
  },
});
