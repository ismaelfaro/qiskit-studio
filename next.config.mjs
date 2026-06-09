/**
 * Copyright contributors to the Qiskit Studio project
 * SPDX-License-Identifier: Apache-2.0
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    // Rewrite barrel imports (e.g. `import { X } from "lucide-react"`) to direct
    // deep imports so dev only compiles the icons/modules actually used. With
    // 35 files importing from lucide-react, this sharply cuts the dev module
    // count and first-compile time.
    optimizePackageImports: ["lucide-react", "reactflow", "react-markdown"],
  },
}

export default nextConfig
