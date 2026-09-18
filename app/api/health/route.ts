import { NextResponse } from "next/server";

import { mastra } from "@/src/mastra";

export function GET() {
  const agents = Object.keys(mastra.getAgents());

  return NextResponse.json({
    status: "ok",
    service: "github-pr-review-agent",
    phase: 3,
    agents,
    workflows: Object.keys(mastra.getWorkflows()),
    configuredModel: process.env.OPENAI_MODEL ?? "openai/gpt-4o-mini",
    timestamp: new Date().toISOString(),
  });
}
