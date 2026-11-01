import Anthropic from "@anthropic-ai/sdk";
import {
  AnthropicAdapter,
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

export const dynamic = "force-dynamic";

const runtime = new CopilotRuntime();

// @ai-sdk/anthropic appends `/messages` to the base URL, so it must end in /v1.
function anthropicBase(url?: string) {
  const u = (url || "http://127.0.0.1:15721").replace(/\/+$/, "");
  return u.endsWith("/v1") ? u : `${u}/v1`;
}

const serviceAdapter = new AnthropicAdapter({
  anthropic: new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || "local-proxy",
    baseURL: anthropicBase(process.env.LLM_BASE_URL),
    defaultHeaders: {
      "user-agent": "claude-cli/1.0 (external)",
      // OpenCode proxy refuses requests without a session id.
      "x-opencode-session": process.env.LLM_SESSION_ID || "spec2test-webapp",
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
