import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Шрифти для PDF читаються з диска на сервері
  outputFileTracingIncludes: { "/api/employees/pdf": ["./assets/fonts/**"] },
};

export default nextConfig;
