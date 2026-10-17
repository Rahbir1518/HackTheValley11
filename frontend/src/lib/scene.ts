import type { Object3D } from "three";

/** One row in the Hierarchy panel. Built from glTF nodes that carry an Ordis `role` (glTF extras). */
export interface SceneNode {
  id: string; // Object3D uuid
  name: string;
  role: string;
  props: Record<string, unknown>;
  children: SceneNode[];
}

export const ROLE_LABEL: Record<string, string> = {
  proposed: "Proposed",
  existing: "Existing",
  existing_on_site: "Existing (on site)",
  lot: "Lot",
  ground: "Ground",
  parcels: "Parcels",
  trees: "Trees",
  floor_lines: "Floor lines",
  group: "Group",
};

export function displayName(o: Object3D) {
  return o.name.replace(/_/g, " ").trim() || o.type;
}

/** The nearest ancestor (or self) that is a hierarchy node. Multi-material meshes load as a
 * Group with one child mesh per material; clicks hit the children. */
export function selectableAncestor(o: Object3D | null): Object3D | null {
  while (o) {
    if (o.userData?.role || isGroupNode(o)) return o;
    o = o.parent;
  }
  return null;
}

function isGroupNode(o: Object3D) {
  // Blender empties used as folders ("Context", "Site", "Proposed Building") have no role
  // unless metadata was attached; treat any named, non-mesh node with children as a folder.
  return o.type === "Object3D" && o.children.length > 0 && !!o.name && o.name !== "Scene";
}

export function buildTree(root: Object3D): SceneNode[] {
  const walk = (o: Object3D): SceneNode[] => {
    if (o.userData?.role || isGroupNode(o)) {
      const kids = o.children.flatMap(walk);
      return [{
        id: o.uuid,
        name: displayName(o),
        role: (o.userData?.role as string) ?? "group",
        props: o.userData ?? {},
        children: kids,
      }];
    }
    return o.children.flatMap(walk);
  };
  return root.children.flatMap(walk);
}

/** Is this object part of the proposal (hidden in the "without" view)? */
export function isProposed(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) {
    if (p.userData?.role === "proposed" || p.name === "Proposed_Building") return true;
  }
  return false;
}

export function isOnSite(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) {
    if (p.userData?.role === "existing_on_site") return true;
  }
  return false;
}
