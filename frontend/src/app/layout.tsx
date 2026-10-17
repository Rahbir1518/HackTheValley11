import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import { clerkEnabled } from "@/lib/auth-config";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Ordis: what's being built near you",
  description:
    "Enter a Toronto address and see nearby development applications as a 3D model among the real buildings around them, with a sun and shadow study and a plain-language summary.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const page = (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
  return clerkEnabled ? <ClerkProvider afterSignOutUrl="/">{page}</ClerkProvider> : page;
}
