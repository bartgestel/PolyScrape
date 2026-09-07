import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Repo has a second lockfile (the collector's) one level up; pin the root here.
  turbopack: { root },
  outputFileTracingRoot: root,
  // pg is server-only; keep it external to the bundle.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
