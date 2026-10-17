"use client";

import type { ReactNode } from "react";

export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-b border-ed-border bg-ed-header px-2 text-[11px] text-ed-text">
      <span className="rounded-t border-x border-t border-ed-border bg-ed-panel px-2 py-0.5 font-medium">{title}</span>
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  );
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="border-b border-ed-border">
      <summary className="cursor-pointer select-none bg-[#303030] px-2 py-1 text-[11px] font-semibold text-ed-text hover:bg-ed-hover">
        {title}
      </summary>
      <div className="space-y-1 px-3 py-2">{children}</div>
    </details>
  );
}

export function Field({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[44%_56%] items-start gap-2 text-[11px]" title={hint}>
      <span className="truncate text-ed-dim">{label}</span>
      <span className="break-words text-ed-text">{value}</span>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "stated" | "estimated" | "warn" }) {
  const tones = {
    neutral: "bg-[#3a3a3a] text-ed-text",
    stated: "bg-[#1f4d2b] text-[#9be3ae]",
    estimated: "bg-[#5a3a12] text-permit-soft",
    warn: "bg-[#5c1f1f] text-[#ffb3b3]",
  };
  return <span className={`rounded px-1.5 py-px text-[10px] font-medium ${tones[tone]}`}>{children}</span>;
}

export function ToolButton({
  active,
  onClick,
  children,
  title,
  disabled,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`h-6 rounded border px-2 text-[11px] transition-colors disabled:opacity-40 ${
        active
          ? "border-[#1d4466] bg-ed-select text-white"
          : "border-ed-border bg-[#4a4a4a] text-ed-text hover:bg-[#565656]"
      }`}
    >
      {children}
    </button>
  );
}
