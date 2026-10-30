import React from "react";
import ReactDOM from "react-dom/client";
import * as Tooltip from "@radix-ui/react-tooltip";
import App from "./App";
import { ToastProvider } from "./ui";
import "@fontsource-variable/inter";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Tooltip.Provider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </Tooltip.Provider>
  </React.StrictMode>
);

// 生产构建下注册离线外壳；开发态与不支持的环境静默跳过
const env = (import.meta as unknown as { env?: { PROD?: boolean } }).env;
if (env?.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/web/sw.js", { scope: "/web/" }).catch(() => undefined);
  });
}
