export function openCasePanel(caseId: string) {
  if (typeof window === "undefined" || !caseId) return;
  window.dispatchEvent(new CustomEvent("s2t-open-case", { detail: caseId }));
}
