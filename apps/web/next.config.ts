import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    // Production routes the API and WebSockets at the ingress, avoiding an extra proxy.
    if (process.env.NODE_ENV !== "development") return [];
    const origin = process.env.HYDRA_API_URL ?? "http://localhost:5000";
    return ["/api/:path*", "/auth/:path*", "/hubs/:path*"].map((source) => ({
      source, destination: `${origin}${source}`,
    }));
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
};
export default nextConfig;
