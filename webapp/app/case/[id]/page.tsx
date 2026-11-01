"use client";
import { use } from "react";
import { CaseView } from "@/views/CaseView";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CaseView caseId={id} />;
}
