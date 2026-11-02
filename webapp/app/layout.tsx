import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import "@copilotkit/react-ui/styles.css";
import { AppProviders } from "@/components/AppProviders";
import { AppShell } from "@/components/AppShell";
import { CaseDrawer } from "@/components/CaseDrawer";
import { CopilotProvider } from "@/components/CopilotProvider";

export const metadata: Metadata = {
  title: "Spec2Test",
  description: "3GPP 一致性测试用例生成",
};

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex-sans",
  weight: ["400", "500", "600"],
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="h-full font-sans">
        <AppProviders>
          <CopilotProvider>
            <AppShell>{children}</AppShell>
            <CaseDrawer />
          </CopilotProvider>
        </AppProviders>
      </body>
    </html>
  );
}
