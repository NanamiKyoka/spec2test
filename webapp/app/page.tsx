"use client";

import { useEffect, useState } from "react";

export default function Page() {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="p-6 font-mono text-sm">
      {error ? `后端不可达：${error}` : JSON.stringify(health)}
    </main>
  );
}
