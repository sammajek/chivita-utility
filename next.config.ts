import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The presentation generator reads the logo from disk on the server; make sure it is deployed with that route.
  outputFileTracingIncludes: {
    "/reports/deck": ["./public/chivita-logo.png"],
  },
};

export default nextConfig;
