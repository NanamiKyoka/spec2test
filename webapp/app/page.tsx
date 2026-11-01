"use client";

import { useEffect } from "react";

export default function Page() {
  useEffect(() => {
    const raw = window.location.hash.replace(/^#\/?/, "");
    const [path, query] = raw.split("?");
    if (!path) return;
    if (path === "case") {
      const id = new URLSearchParams(query || "").get("case");
      if (id) window.location.replace(`/case/${encodeURIComponent(id)}`);
      return;
    }
    if (["data", "eval", "api", "about", "chat"].includes(path)) {
      window.location.replace(path === "chat" ? "/" : `/${path}`);
    }
  }, []);
  return null;
}
