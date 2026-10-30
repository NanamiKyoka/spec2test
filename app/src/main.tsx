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
