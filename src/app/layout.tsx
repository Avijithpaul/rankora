import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "Rankora — All-in-One SEO Analyze, Fix & Optimization Platform", template: "%s · Rankora" },
  description:
    "Audit your website, track rankings, connect Google Search Console and GA4, and get prioritised, explainable SEO recommendations.",
  openGraph: { siteName: "Rankora", type: "website" },
};

export const viewport: Viewport = { themeColor: "#0d1424" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
