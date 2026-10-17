import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { clerkEnabled } from "@/lib/auth-config";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Ordis: what's being built near you",
  description:
    "Enter a Toronto address and see nearby development applications as a 3D model among the real buildings around them, with a sun and shadow study and a plain-language summary.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const page = (
    <html lang="en" className={`${inter.variable} ${plexMono.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
  return clerkEnabled ? (
    <ClerkProvider afterSignOutUrl="/" signInFallbackRedirectUrl="/ask" signUpFallbackRedirectUrl="/ask">
      {page}
    </ClerkProvider>
  ) : (
    page
  );
}
