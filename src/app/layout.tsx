import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "르슐랭 가이드",
  description: "좋아하는 유튜버가 다녀간 식당을 지도에서 찾고, 원본 영상과 방문자 반응을 확인하세요.",
  icons: { icon: [{ url: "/lesulin-icon-32.png?v=4", sizes: "32x32" }, { url: "/lesulin-icon-192.png?v=4", sizes: "192x192" }], shortcut: "/lesulin-favicon.ico?v=4", apple: "/img/brand/apple-icon.png?v=4" },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, maximumScale: 1, themeColor: "#FFFFFF",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
