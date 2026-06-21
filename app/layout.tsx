import type { Metadata } from "next";
import { Inter, Space_Mono } from "next/font/google";
import "./globals.css";

// Inter: variable font, used as --font-figtree
const inter = Inter({
  variable: "--font-figtree",
  subsets: ["latin"],
});

// Space Mono: variable font, used as --font-robot for tailwind class 'font-robot'
const spaceMono = Space_Mono({
  variable: "--font-robot",
  subsets: ["latin"],
  weight: ["400", "700"], // Space Mono supports 400 & 700
});

export const metadata: Metadata = {
  title: "Sitewide",
  description: "Agentic AI for CRO",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceMono.variable} h-full font-sans antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
