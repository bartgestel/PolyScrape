import type { Metadata } from "next";
import { Suspense } from "react";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "PolyScrape viewer",
  description: "Read-only viewer for collected Polymarket sports/weather market data",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={<nav className="top" />}>
          <Nav />
        </Suspense>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
