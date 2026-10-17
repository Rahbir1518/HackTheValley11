import type { Object3D } from "three";

/** One row in the scene collection. Built from glTF nodes that carry an Ordis `role` (glTF extras).
 *  Ids are object names (unique in Blender), so two views of the same scene share them. */
export interface SceneNode {
  id: string;
  name: string;
  role: string;
  props: Record<string, unknown>;
  children: SceneNode[];
}

export function displayName(o: Object3D) {
  return o.name.replace(/_/g, " ").trim() || o.type;
}

/** Nearest ancestor (or self) that is a scene-collection node. Multi-material meshes load
 *  as a Group with one child mesh per material; clicks hit the children. */
export function selectableAncestor(o: Object3D | null): Object3D | null {
  while (o) {
    if (o.userData?.role || isGroupNode(o)) return o;
    o = o.parent;
  }
  return null;
}

function isGroupNode(o: Object3D) {
  return o.type === "Object3D" && o.children.length > 0 && !!o.name && o.name !== "Scene";
}

export function buildTree(root: Object3D): SceneNode[] {
  const walk = (o: Object3D): SceneNode[] => {
    if (o.userData?.role || isGroupNode(o)) {
      return [{
        id: o.name,
        name: displayName(o),
        role: (o.userData?.role as string) ?? "group",
        props: o.userData ?? {},
        children: o.children.flatMap(walk),
      }];
    }
    return o.children.flatMap(walk);
  };
  return root.children.flatMap(walk);
}

export function hasAncestor(o: Object3D, test: (p: Object3D) => boolean): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (test(p)) return true;
  return false;
}

/** Is this object part of the proposal (hidden in the "existing" view)? */
export const isProposed = (o: Object3D) =>
  hasAncestor(o, (p) => p.userData?.role === "proposed" || p.name === "Proposed_Building");

export const isOnSite = (o: Object3D) => hasAncestor(o, (p) => p.userData?.role === "existing_on_site");

export function findNode(nodes: SceneNode[], id: string | null): SceneNode | null {
  if (!id) return null;
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/** Shades for the other proposals in the block view (the viewed proposal keeps its blue). */
export const BLOCK_COLORS = ["#D9A066", "#8FB585", "#C38DB4", "#DE8B76", "#74AFA9", "#A99BD8", "#C9B26A", "#8AA0C9"];
export const blockColor = (i: number) => BLOCK_COLORS[i % BLOCK_COLORS.length];
