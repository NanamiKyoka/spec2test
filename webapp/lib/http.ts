export async function fetchJson<T>(live: string, snap: string): Promise<{ data: T | null; from: "live" | "snapshot" | "none" }> {
  for (const [path, from] of [
    [live, "live"],
    [snap, "snapshot"],
  ] as const) {
    try {
      const r = await fetch(path, { cache: "no-store" });
      if (r.ok) return { data: (await r.json()) as T, from };
    } catch {
      /* 继续尝试下一个来源 */
    }
  }
  return { data: null, from: "none" };
}
