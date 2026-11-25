import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

const lanHosts = Object.values(networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .filter((address) => address.family === "IPv4" && !address.internal)
  .map((address) => address.address);

const nextConfig: NextConfig = {
  allowedDevOrigins: lanHosts,
};

export default nextConfig;
