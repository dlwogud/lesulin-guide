import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  /* 시작 화면은 정적 파일(public/index.html)입니다. Vercel 은 / 에 index.html 을
     알아서 내주지만 next dev 는 404 라서, 로컬과 배포를 같게 맞춥니다. */
  async rewrites() {
    return [{ source: "/", destination: "/index.html" }];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
