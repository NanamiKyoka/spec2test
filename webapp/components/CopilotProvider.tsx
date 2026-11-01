"use client";

import { CopilotKit } from "@copilotkit/react-core";

export function CopilotProvider({ children }: { children: React.ReactNode }) {
  // 1.83 的 Next 端点只实现 v2 单路由协议，必须显式开启单端点传输
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint>
      {children}
    </CopilotKit>
  );
}
