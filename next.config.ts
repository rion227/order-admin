// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Node.js で動かすためのサーバ出力（Vercel/Render/Railwayなどで安定）
  output: "standalone",

  // （任意）CIでのビルド安定化。Lintは警告に留める
  eslint: { ignoreDuringBuilds: true },
  // 型エラーで落としたい場合は false のまま。無視したいなら true に変更
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
