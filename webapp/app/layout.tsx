import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import "@copilotkit/react-ui/styles.css";
import { AppProviders } from "@/components/AppProviders";
import { CaseDrawer } from "@/components/CaseDrawer";
import { CopilotProvider } from "@/components/CopilotProvider";
import { PageTransition } from "@/components/PageTransition";
import { StatusBar } from "@/components/StatusBar";

export const metadata: Metadata = {
  title: "Spec2Test",
  description: "把 3GPP 测试条款编译成可校验的测试意图",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="h-full">
        <AppProviders>
          <CopilotProvider>
            <div className="flex h-full flex-col">
              <StatusBar />
              <main className="min-h-0 flex-1 overflow-hidden">
                <PageTransition>{children}</PageTransition>
              </main>
            </div>
            <CaseDrawer />
          </CopilotProvider>
        </AppProviders>
      </body>
    </html>
  );
}
