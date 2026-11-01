import type { NextConfig } from "next";

const PY = process.env.PY_API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    // afterFiles：先匹配 app/api/* 的真实路由（/api/copilotkit），其余再转给 Python
    return {
      afterFiles: [
        { source: "/api/:path*", destination: `${PY}/api/:path*` },
        { source: "/data/:path*", destination: `${PY}/data/:path*` },
        { source: "/results/:path*", destination: `${PY}/results/:path*` },
      ],
    };
  },
};

export default nextConfig;
