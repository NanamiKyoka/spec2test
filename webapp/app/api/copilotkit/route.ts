import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  AnthropicAdapter,
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

export const dynamic = "force-dynamic";

const runtime = new CopilotRuntime();

// @ai-sdk/anthropic appends `/messages` to the base URL, so it must end in /v1.
// Accept full endpoint URLs too and reduce them to the API root.
function anthropicBase(raw?: string) {
  const input = (raw || "http://127.0.0.1:15721").trim();
  try {
    const parsed = new URL(input);
    let path = parsed.pathname.replace(/\/+$/, "");
    for (const suffix of ["/v1/messages", "/messages", "/chat/completions"]) {
      if (path.endsWith(suffix)) {
        path = path.slice(0, -suffix.length);
        break;
      }
    }
    if (!path.endsWith("/v1")) path = `${path}/v1`;
    parsed.pathname = path.replace(/\/{2,}/g, "/");
    parsed.search = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return input;
  }
}

const serviceAdapter = new AnthropicAdapter({
  anthropic: new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || "local-proxy",
    baseURL: anthropicBase(process.env.LLM_BASE_URL),
    defaultHeaders: {
      "user-agent": "claude-cli/1.0 (external)",
      // OpenCode proxy refuses requests without a session id.
      "x-opencode-session": process.env.LLM_SESSION_ID || randomUUID(),
    },
  }),
  model: process.env.LLM_MODEL || "claude-sonnet-4-6[1M]",
});

const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime,
  serviceAdapter,
  endpoint: "/api/copilotkit",
});

export const POST = handleRequest;
