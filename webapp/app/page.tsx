"use client";

import { useEffect, useState } from "react";

export default function Page() {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="p-6 font-mono text-sm">
      {error ? `后端不可达：${error}` : health ? JSON.stringify(health) : "检查中…"}
    </main>
  );
}
