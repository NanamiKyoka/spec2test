import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import "@copilotkit/react-ui/styles.css";
import { AppProviders } from "@/components/AppProviders";

export const metadata: Metadata = {
  title: "Spec2Test",
  description: "把 3GPP 测试条款编译成可校验的测试意图",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="h-full">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
