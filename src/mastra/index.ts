import { Mastra } from "@mastra/core/mastra";

import { prReviewAgent } from "./agents/pr-review-agent";
import { prReviewWorkflow } from "./workflows";

export const mastra = new Mastra({
  agents: {
    prReviewAgent,
  },
  workflows: {
    prReviewWorkflow,
  },
});
