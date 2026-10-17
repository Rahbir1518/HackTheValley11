"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/auth-config";
import { Identity } from "./brand";

/** Top navigation for the signed-in app (Ask Ordis / 3D viewer). */
export default function AppNav({ active, viewerHref = "/viewer" }: { active: "ask" | "viewer"; viewerHref?: string }) {
  const link = (key: "ask" | "viewer", href: string, label: string) => (
    <Link href={href} className={key === active ? "font-semibold text-ink" : "text-muted hover:text-ink"}>
      {label}
    </Link>
  );
  return (
    <nav className="flex h-16 shrink-0 items-center justify-between border-b border-line bg-white px-6">
      <div className="flex items-center gap-7">
        <Identity />
        <div className="h-5 w-px bg-line" />
        <div className="flex items-center gap-6 text-[13px]">
          {link("ask", "/ask", "Ask Ordis")}
          {link("viewer", viewerHref, "3D viewer")}
        </div>
      </div>
      <div className="flex items-center gap-5">
        <Link href="/#data" className="text-[12px] text-muted hover:text-ink">
          About the data ↗
        </Link>
        {clerkEnabled ? (
          <UserButton />
        ) : (
          <span className="grid size-[30px] place-items-center rounded-full bg-soft text-[12px]">A</span>
        )}
      </div>
    </nav>
  );
}
