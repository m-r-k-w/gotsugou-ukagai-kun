import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ご都合うかがい君（仮）",
  description: "なぞって答える、定例ミーティングの曜日・時間帯調整。",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
