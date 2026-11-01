"use client";
import { ApiView } from "@/views/ApiView";
import { ToastProvider } from "@/ui";
export default function Page() {
  return (
    <ToastProvider>
      <ApiView />
    </ToastProvider>
  );
}
