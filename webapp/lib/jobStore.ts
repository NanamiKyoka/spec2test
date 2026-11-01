import type { Job } from "./api";

type JobWithCase = Job & { case?: string };

const byId = new Map<string, JobWithCase>();
const byCase = new Map<string, JobWithCase>();
const listeners = new Set<() => void>();
let latestId: string | null = null;

export function setJob(jobId: string, job: JobWithCase) {
  byId.set(jobId, job);
  if (job.case) byCase.set(job.case, job);
  latestId = jobId;
  listeners.forEach((fn) => fn());
}

export function getJob(jobId: string) {
  return byId.get(jobId);
}

export function getJobByCase(caseId: string) {
  return byCase.get(caseId);
}

export function getLatestJob() {
  return latestId ? byId.get(latestId) : undefined;
}

export function subscribeJobs(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetJobs() {
  byId.clear();
  byCase.clear();
  listeners.clear();
  latestId = null;
}
