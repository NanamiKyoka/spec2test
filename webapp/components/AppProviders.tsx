"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { ToastProvider } from "@/ui";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip.Provider>
      <ToastProvider>{children}</ToastProvider>
    </Tooltip.Provider>
  );
}
