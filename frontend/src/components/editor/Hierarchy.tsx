"use client";

import { useState } from "react";
import { ROLE_LABEL, type SceneNode } from "@/lib/scene";
import { PanelHeader } from "./ui";

const ROLE_DOT: Record<string, string> = {
  proposed: "bg-permit",
  existing: "bg-concrete",
  existing_on_site: "bg-steel",
  lot: "bg-black border border-[#666]",
  trees: "bg-[#3f8a3a]",
  parcels: "bg-[#8a8a87]",
  ground: "bg-[#333]",
};

interface Props {
  tree: SceneNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  hidden: Set<string>;
  onToggleHidden: (id: string) => void;
  title: string;
}

export default function Hierarchy({ tree, selectedId, onSelect, hidden, onToggleHidden, title }: Props) {
  const [filter, setFilter] = useState("");
  const match = (n: SceneNode): boolean =>
    !filter || n.name.toLowerCase().includes(filter.toLowerCase()) || n.children.some(match);

  return (
    <div className="flex h-full flex-col bg-ed-panel">
      <PanelHeader title="Hierarchy" />
      <div className="border-b border-ed-border p-1.5">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search…"
          className="h-6 w-full rounded border border-ed-border bg-[#1e1e1e] px-2 text-[11px] text-ed-text outline-none focus:border-ed-select"
        />
      </div>
      <div className="flex-1 overflow-auto py-1 text-[12px] text-ed-text">
        {tree.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-ed-dim">No scene loaded. Search an address to build one.</p>
        ) : (
          <>
            <div className="flex items-center gap-1.5 px-2 py-0.5 font-semibold">
              <span className="text-ed-dim">▾</span> {title}
            </div>
            {tree.filter(match).map((n) => (
              <Row key={n.id} node={n} depth={1} {...{ selectedId, onSelect, hidden, onToggleHidden, match }} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  node,
  depth,
  selectedId,
  onSelect,
  hidden,
  onToggleHidden,
  match,
}: {
  node: SceneNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  hidden: Set<string>;
  onToggleHidden: (id: string) => void;
  match: (n: SceneNode) => boolean;
}) {
  // Big groups (hundreds of existing buildings) start collapsed.
  const [open, setOpen] = useState(node.children.length < 30);
  const selected = node.id === selectedId;
  const isHidden = hidden.has(node.id);
  return (
    <>
      <div
        onClick={() => onSelect(node.id)}
        className={`group flex h-[22px] cursor-default items-center gap-1 pr-2 ${
          selected ? "bg-ed-select text-white" : "hover:bg-ed-hover"
        } ${isHidden ? "opacity-45" : ""}`}
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          className={`w-3 text-[10px] text-ed-dim ${node.children.length ? "" : "invisible"}`}
        >
          {open ? "▾" : "▸"}
        </button>
        <span className={`h-2 w-2 shrink-0 rounded-sm ${ROLE_DOT[node.role] ?? "bg-[#5a5a5a]"}`} />
        <span className="truncate" title={ROLE_LABEL[node.role] ?? node.role}>
          {node.name}
        </span>
        {node.children.length > 0 && <span className="text-[10px] text-ed-dim">{node.children.length}</span>}
        <button
          type="button"
          title={isHidden ? "Show" : "Hide"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleHidden(node.id);
          }}
          className={`ml-auto text-[11px] text-ed-dim hover:text-white ${isHidden ? "" : "opacity-0 group-hover:opacity-100"}`}
        >
          {isHidden ? "◌" : "●"}
        </button>
      </div>
      {open &&
        node.children
          .filter(match)
          .map((c) => (
            <Row key={c.id} node={c} depth={depth + 1} {...{ selectedId, onSelect, hidden, onToggleHidden, match }} />
          ))}
    </>
  );
}
