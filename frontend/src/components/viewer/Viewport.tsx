"use client";

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, Grid, Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { BlockProposal, StreetCamera } from "@/lib/api";
import { blockColor, hasAncestor, isOnSite, isProposed, selectableAncestor } from "@/lib/scene";
import type { Sun } from "@/lib/sun";

export type Tool = "select" | "pan" | "orbit";
export interface Layers {
  context: boolean;
  trees: boolean;
  lots: boolean;
  grid: boolean;
}
/** Shared camera for side-by-side views: whichever view the user drives writes, the other follows. */
export interface CameraSync {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  version: number;
  owner: string;
}

export interface ViewportProps {
  id: string;
  glbUrl: string;
  showProposal: boolean;
  hidden: Set<string>;
  selectedId: string | null;
  onSelect?: (id: string | null) => void;
  onLoaded?: (root: THREE.Object3D) => void;
  sun: Sun;
  shadows: boolean;
  layers: Layers;
  tool: Tool;
  focusToken: number;
  heatmap?: { url: string; extent: number } | null;
  annotation?: string | null;
  sync?: React.MutableRefObject<CameraSync>;
  /** Other active proposals nearby, drawn together with this one ("your block in 5 years"). */
  block?: BlockProposal[] | null;
  selectedBlock?: string | null;
  onSelectBlock?: (appNumber: string | null) => void;
  /** Construction animation: changing this token makes the proposal rise floor by floor. */
  rise?: number;
  /** Height of the top of each storey (from the spec), used to step the rise one storey at a time. */
  storeyTops?: number[];
  /** The axis gizmo (desktop); hidden on the phone view. */
  gizmo?: boolean;
}

const CANVAS = "#edf0ef";

export default function Viewport(props: ViewportProps) {
  const night = !props.sun.up;
  // The block view frames every proposal, in both halves of a split view alike.
  const blockBounds = useMemo(() => {
    if (!props.block?.length) return null;
    const box = new THREE.Box3();
    for (const p of props.block) for (const m of p.masses) for (const [x, y] of m.ring) box.expandByPoint(new THREE.Vector3(x, m.top, -y));
    return box;
  }, [props.block]);
  return (
    <Canvas
      shadows="percentage"
      camera={{ position: [170, 150, 210], fov: 40, near: 0.5, far: 6000 }}
      gl={{ antialias: true, preserveDrawingBuffer: true, localClippingEnabled: true }}
      onPointerMissed={() => props.tool === "select" && props.onSelect?.(null)}
    >
      <color attach="background" args={[night ? "#cfd6d5" : CANVAS]} />
      <fog attach="fog" args={[night ? "#cfd6d5" : CANVAS, 700, 1800]} />
      <SunLight sun={props.sun} shadows={props.shadows} />
      {props.layers.grid && (
        <Grid
          position={[0, 0.03, 0]}
          infiniteGrid
          cellSize={10}
          sectionSize={50}
          cellColor="#d7dbd8"
          sectionColor="#c9cfcb"
          fadeDistance={800}
          cellThickness={0.5}
          sectionThickness={0.8}
        />
      )}
      <Suspense fallback={null}>
        <Model {...props} />
        {props.block && props.showProposal && (
          <BlockMasses proposals={props.block} selected={props.selectedBlock ?? null} onSelect={props.tool === "select" ? props.onSelectBlock : undefined} />
        )}
      </Suspense>
      {props.heatmap && <Heatmap {...props.heatmap} />}
      <Controls id={props.id} tool={props.tool} focusToken={props.focusToken} sync={props.sync} extraBounds={blockBounds} />
      {props.gizmo !== false && (
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport axisColors={["#727773", "#727773", "#566f87"]} labelColor="#ffffff" axisHeadScale={0.8} />
        </GizmoHelper>
      )}
      {process.env.NODE_ENV === "development" && props.id === "main" && <DebugHandle />}
    </Canvas>
  );
}

// ------------------------------------------------------------------ from the street (photomontage)

export interface StreetOverlayProps {
  glbUrl: string;
  camera: StreetCamera;
  showProposal: boolean;
  block?: BlockProposal[] | null;
}

/** Puts a three.js camera exactly where the Street View camera was (heading clockwise from
 *  north, pitch up). Local metres: x east, y north; three.js is y-up with north = -z. */
function aimStreetCamera(camera: THREE.PerspectiveCamera, c: StreetCamera) {
  const h = THREE.MathUtils.degToRad(c.heading);
  const p = THREE.MathUtils.degToRad(c.pitch);
  camera.fov = c.vfov;
  camera.aspect = c.width / c.height;
  camera.near = 1;
  camera.far = 4000;
  camera.position.set(c.x, c.height_m, -c.y);
  camera.lookAt(c.x + Math.sin(h) * Math.cos(p), c.height_m + Math.sin(p), -c.y - Math.cos(h) * Math.cos(p));
  camera.updateProjectionMatrix();
}

/** Transparent layer over a Street View photo: only the proposal is drawn; the City's existing
 *  buildings are drawn invisibly (depth only) so they hide the parts of it behind them. */
export function StreetOverlay(props: StreetOverlayProps) {
  return (
    <Canvas
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true, localClippingEnabled: true }}
      camera={{ manual: true }}
      style={{ background: "transparent" }}
    >
      <StreetLights camera={props.camera} />
      <StreetRig camera={props.camera} />
      <Suspense fallback={null}>
        <StreetScene {...props} />
        {props.block && props.showProposal && <BlockMasses proposals={props.block} selected={null} />}
      </Suspense>
    </Canvas>
  );
}

/** Soft daylight from behind and above the camera, so the facade facing the viewer is always
 *  readable against the photo (the photo's own lighting has nothing to do with the study clock). */
function StreetLights({ camera: c }: { camera: StreetCamera }) {
  const h = THREE.MathUtils.degToRad(c.heading);
  return (
    <>
      <hemisphereLight args={["#ffffff", "#c9cfcc", 1.5]} />
      <directionalLight position={[c.x - Math.sin(h) * 300 + 120, 400, -c.y + Math.cos(h) * 300]} intensity={2.2} />
    </>
  );
}

function StreetRig({ camera: c }: { camera: StreetCamera }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useLayoutEffect(() => aimStreetCamera(camera, c), [camera, c]);
  return null;
}

function StreetScene({ glbUrl, showProposal }: StreetOverlayProps) {
  const { scene: original } = useGLTF(glbUrl);
  const scene = useMemo(() => {
    const copy = original.clone(true);
    const occluder = new THREE.MeshBasicMaterial({ colorWrite: false });
    copy.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !isProposed(o) && hasAncestor(o, (p) => p.name === "Existing_Buildings") && !isOnSite(o)) {
        m.material = occluder;
        m.renderOrder = -1; // depth first, so the proposal behind it is hidden
      }
    });
    return copy;
  }, [original]);
  useEffect(() => {
    scene.traverse((o) => {
      if (o === scene) return;
      const flat = hasAncestor(o, (p) => ["Ground", "Parcels", "Site", "Street_Trees"].includes(p.name));
      o.visible = !flat && !isOnSite(o) && (!isProposed(o) || showProposal);
    });
  }, [scene, showProposal]);
  return <primitive object={scene} />;
}

/** Dev only: exposes the renderer for browser-driven checks (window.__ordis). */
function DebugHandle() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    (window as unknown as { __ordis: unknown }).__ordis = get;
  }, [get]);
  return null;
}

// ------------------------------------------------------------------ sun

function SunLight({ sun, shadows }: { sun: Sun; shadows: boolean }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const [x, y, z] = sun.direction;
  const intensity = sun.up ? 2.2 + 2.4 * Math.min(1, sun.altitudeDeg / 30) : 0;
  useEffect(() => {
    const cam = light.current?.shadow.camera;
    if (!cam) return;
    cam.left = cam.bottom = -380;
    cam.right = cam.top = 380;
    cam.near = 1;
    cam.far = 2400;
    cam.updateProjectionMatrix();
  }, []);
  return (
    <>
      <hemisphereLight args={["#ffffff", "#aab4b1", sun.up ? 0.95 : 0.9]} />
      <directionalLight
        ref={light}
        position={[x * 1000, Math.max(y, 0.02) * 1000, z * 1000]}
        intensity={intensity}
        color={sun.altitudeDeg < 8 ? "#ffe2c4" : "#ffffff"}
        castShadow={shadows && sun.up}
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
      />
    </>
  );
}

// ------------------------------------------------------------------ model

// ------------------------------------------------------------------ construction animation

/** Clipping-plane height that clips nothing. */
const OPEN = 1e6;
/** Last rise token played per viewport + scene, so remounting a view doesn't replay it. */
const risen = new Map<string, number>();

function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** While rising, faces render double-sided so the open top reads as a building under construction. */
function setUnderConstruction(materials: THREE.Material[], on: boolean) {
  for (const m of materials) {
    m.userData.side ??= m.side;
    m.side = on ? THREE.DoubleSide : m.userData.side;
    m.needsUpdate = true;
  }
}

/** True from the frame after mount. drei <Html> creates its own React root, which must not
 *  happen inside the commit that creates the canvas: when the model is already in memory
 *  (e.g. back from another page) nothing suspends, and dev StrictMode warns about unmounting a
 *  root mid-render. Every <Html> label waits for this. */
function useAfterFirstFrame() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return ready;
}

/** Seconds for n storeys to rise, one at a time. */
const riseSeconds = (n: number) => Math.min(4.2, Math.max(1.8, n * 0.065));

/** Moves each clipping plane to the top of the storeys built so far (progress p from 0 to 1). */
function stepRise(rig: { plane: THREE.Plane; top: number; storeys: number }[], p: number) {
  for (const r of rig) r.plane.constant = p >= 1 ? OPEN : (r.top * Math.ceil(Math.max(0, p) * r.storeys)) / r.storeys;
}

function Model({ id, glbUrl, showProposal, hidden, selectedId, onSelect, onLoaded, layers, tool, annotation, block, rise, storeyTops }: ViewportProps) {
  const { scene: original } = useGLTF(glbUrl);
  // Each view gets its own copy so two canvases can show the same scene, and its own proposal
  // materials so the construction clipping plane never leaks into another view.
  const scene = useMemo(() => {
    const copy = original.clone(true);
    copy.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material && isProposed(o)) m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    });
    return copy;
  }, [original]);

  const htmlReady = useAfterFirstFrame();

  // ---- floor-by-floor rise: a clipping plane steps up one storey at a time
  const build = useRef<{ clip: THREE.Plane; materials: THREE.Material[]; roof: number; top: number } | null>(null);
  const anim = useRef<{ t0: number; shown: number } | null>(null);
  const labelGroup = useRef<THREE.Group>(null);
  const labelFinal = useRef<HTMLSpanElement>(null);
  const labelLive = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), OPEN);
    const materials: THREE.Material[] = [];
    let roof = 0;
    let top = 0;
    scene.updateWorldMatrix(true, true);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.material || !isProposed(o)) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        mat.clippingPlanes = [clip];
        mat.clipShadows = true;
        materials.push(mat);
      }
      if (!m.isMesh) return;
      const y = new THREE.Box3().setFromObject(o).max.y;
      top = Math.max(top, y);
      // The roof of the tallest storey, not the mechanical penthouse above it.
      if (!hasAncestor(o, (p) => /penthouse/i.test(p.name))) roof = Math.max(roof, y);
    });
    build.current = { clip, materials, roof, top };
  }, [scene]);

  useLayoutEffect(() => {
    const key = `${id}|${glbUrl}`;
    if (rise === undefined || !storeyTops?.length || risen.get(key) === rise) return;
    risen.set(key, rise);
    if (prefersReducedMotion() || !build.current) return;
    build.current.clip.constant = 0; // before the first frame, so the finished building never flashes
    setUnderConstruction(build.current.materials, true);
    anim.current = { t0: performance.now(), shown: 0 };
  }, [id, glbUrl, rise, storeyTops]);

  useFrame(() => {
    const a = anim.current;
    const b = build.current;
    if (!a || !b || !storeyTops?.length) return;
    const n = storeyTops.length;
    const p = (performance.now() - a.t0) / (riseSeconds(n) * 1000);
    const live = labelLive.current;
    const final = labelFinal.current;
    if (p >= 1.12) {
      // Hold on the last storey for a beat, then the rooftop and the usual label.
      b.clip.constant = OPEN;
      setUnderConstruction(b.materials, false);
      anim.current = null;
      if (labelGroup.current) labelGroup.current.position.y = 0;
      if (live && final) {
        live.style.display = "none";
        final.style.display = "";
      }
      return;
    }
    const k = Math.min(n, Math.max(1, Math.ceil(p * n)));
    if (k === a.shown) return;
    a.shown = k;
    const h = storeyTops[k - 1] * (b.roof / storeyTops[n - 1]);
    b.clip.constant = h;
    if (labelGroup.current) labelGroup.current.position.y = h - b.top; // the label sits 6 m above the finished top
    if (live && final) {
      final.style.display = "none";
      live.style.display = "";
      live.textContent = `${k} ${k === 1 ? "storey" : "storeys"}`;
    }
  });

  useEffect(() => {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const flat = hasAncestor(o, (p) => p.name === "Ground" || p.name === "Parcels" || p.name === "Lot");
      mesh.castShadow = !flat;
      mesh.receiveShadow = true;
    });
    onLoaded?.(scene);
  }, [scene, onLoaded]);

  // Buildings standing today on the other proposals' lots (block view only).
  const replaced = useMemo(() => new Set(showProposal && block ? block.flatMap((p) => p.replaces) : []), [block, showProposal]);

  useEffect(() => {
    scene.traverse((o) => {
      if (o === scene) return;
      let visible = !hidden.has(o.name) && !replaced.has(o.name);
      if (isProposed(o)) visible &&= showProposal;
      if (isOnSite(o)) visible &&= !showProposal;
      if (o.name === "Existing_Buildings") visible &&= layers.context;
      if (o.name === "Street_Trees") visible &&= layers.trees;
      if (o.name === "Parcels") visible &&= layers.lots;
      o.visible = visible;
    });
  }, [scene, showProposal, hidden, layers, replaced]);

  const selected = useMemo(() => (selectedId ? scene.getObjectByName(selectedId) ?? null : null), [scene, selectedId]);
  const proposalTop = useMemo(() => {
    const p = scene.getObjectByName("Proposed_Building");
    if (!p) return null;
    const box = new THREE.Box3().setFromObject(p);
    return box.isEmpty() ? null : new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + 6, (box.min.z + box.max.z) / 2);
  }, [scene]);

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (tool !== "select" || !onSelect) return;
    e.stopPropagation();
    const target = selectableAncestor(e.object);
    onSelect(target ? target.name : null);
  };

  return (
    <>
      <primitive object={scene} onClick={click} />
      {selected && <SelectionOutline object={selected} key={`${id}-${selected.name}`} />}
      {annotation && showProposal && proposalTop && htmlReady && (
        <group position={proposalTop}>
          {/* Moves with the rising storeys during the construction animation. */}
          <group ref={labelGroup}>
            <Html center zIndexRange={[20, 0]}>
              <div className="pointer-events-none flex items-center gap-2.5 whitespace-nowrap rounded-md border border-prop bg-white px-3 py-2 text-[11px] text-prop-ink shadow-sm">
                <span className="size-[7px] bg-prop-ink" />
                <span ref={labelFinal}>{annotation}</span>
                <span ref={labelLive} className="mono tabular-nums" style={{ display: "none" }} />
              </div>
            </Html>
          </group>
        </group>
      )}
    </>
  );
}

/** The other proposals in the block view: one flat shade each, storey lines, and a storey chip.
 *  Rings are local metres (x east, y north); three.js is y-up with north = -z. */
function BlockMasses({ proposals, selected, onSelect }: { proposals: BlockProposal[]; selected: string | null; onSelect?: (appNumber: string | null) => void }) {
  const items = useMemo(
    () =>
      proposals.map((p, i) => {
        const color = new THREE.Color(blockColor(i));
        // Construction rise: starts at ground level (nothing shown) and steps up storey by storey.
        const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), prefersReducedMotion() ? OPEN : 0);
        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.02, clippingPlanes: [plane], clipShadows: true });
        const lineMat = new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(0.62), transparent: true, opacity: 0.75, clippingPlanes: [plane] });
        const meshes: THREE.BufferGeometry[] = [];
        const line: number[] = [];
        let top = 0;
        let label = new THREE.Vector3();
        for (const m of p.masses) {
          const shape = new THREE.Shape(m.ring.map(([x, y]) => new THREE.Vector2(x, y)));
          const g = new THREE.ExtrudeGeometry(shape, { depth: m.top - m.z0, bevelEnabled: false });
          g.rotateX(-Math.PI / 2); // (x, y, depth) -> (x, depth, -y)
          g.translate(0, m.z0, 0);
          meshes.push(g);
          // Storey outlines and the top edge, like the floor lines on the viewed proposal.
          const levels = m.storeys > 1 ? Array.from({ length: m.storeys - 1 }, (_, k) => m.z0 + ((k + 1) * (m.top - m.z0)) / m.storeys) : [];
          for (const h of [...levels, m.top]) {
            m.ring.forEach(([x, y], k) => {
              const [x2, y2] = m.ring[(k + 1) % m.ring.length];
              line.push(x, h + 0.05, -y, x2, h + 0.05, -y2);
            });
          }
          if (m.top >= top) {
            top = m.top;
            const cx = m.ring.reduce((a, [x]) => a + x, 0) / m.ring.length;
            const cy = m.ring.reduce((a, [, y]) => a + y, 0) / m.ring.length;
            label = new THREE.Vector3(cx, top + 6, -cy);
          }
        }
        const lines = new THREE.BufferGeometry();
        lines.setAttribute("position", new THREE.Float32BufferAttribute(line, 3));
        return { p, color: blockColor(i), material, lineMat, meshes, lines, label, plane, top, storeys: Math.max(1, p.spec.total_storeys) };
      }),
    [proposals],
  );
  // They rise floor by floor when they appear; storey chips show once they have topped out.
  const [labels, setLabels] = useState(false);
  const htmlReady = useAfterFirstFrame();
  const anim = useRef<{ t0: number; seconds: number; rig: { plane: THREE.Plane; top: number; storeys: number }[]; materials: THREE.Material[] } | null>(null);
  useLayoutEffect(() => {
    if (prefersReducedMotion()) {
      setLabels(true); // eslint-disable-line react-hooks/set-state-in-effect -- browser-only preference
      return;
    }
    const rig = items.map((it) => ({ plane: it.plane, top: it.top, storeys: it.storeys }));
    const materials = items.map((it) => it.material);
    setUnderConstruction(materials, true);
    anim.current = { t0: performance.now(), seconds: riseSeconds(Math.max(...rig.map((r) => r.storeys))), rig, materials };
  }, [items]);
  useFrame(() => {
    const a = anim.current;
    if (!a) return;
    const p = (performance.now() - a.t0) / (a.seconds * 1000);
    stepRise(a.rig, p);
    if (p >= 1) {
      anim.current = null;
      setUnderConstruction(a.materials, false);
      setLabels(true);
    }
  });
  useEffect(
    () => () =>
      items.forEach((it) => {
        it.meshes.forEach((g) => g.dispose());
        it.lines.dispose();
        it.material.dispose();
        it.lineMat.dispose();
      }),
    [items],
  );
  return (
    <group name="Block_Proposals">
      {items.map((it) => (
        <group
          key={it.p.app_number}
          name={`Block_${it.p.app_number}`}
          onClick={(e) => {
            if (!onSelect) return;
            e.stopPropagation();
            onSelect(it.p.app_number);
          }}
        >
          {it.meshes.map((g, k) => (
            <mesh key={k} geometry={g} material={it.material} castShadow receiveShadow />
          ))}
          <lineSegments geometry={it.lines} material={it.lineMat} />
          {labels && htmlReady && (
            <Html position={it.label} center zIndexRange={[20, 0]}>
              <div
                className={`pointer-events-none flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-white px-2 py-1 text-[10px] text-ink shadow-sm ${selected === it.p.app_number ? "border-ink" : "border-line"}`}
              >
                <span className="size-[7px]" style={{ background: it.color }} />
                {it.p.spec.storeys_stated ? "" : "≈"}
                {it.p.spec.total_storeys} storeys
              </div>
            </Html>
          )}
        </group>
      ))}
    </group>
  );
}

/** Sunlight-lost raster draped on the ground (PNG top row = north, centre = local origin). */
function Heatmap({ url, extent }: { url: string; extent: number }) {
  const texture = useMemo(() => {
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [url]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.35, 0]} renderOrder={5}>
      <planeGeometry args={[extent * 2, extent * 2]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function SelectionOutline({ object }: { object: THREE.Object3D }) {
  const group = useMemo(() => {
    const g = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: "#566f87", depthTest: false, transparent: true, opacity: 0.95 });
    object.updateWorldMatrix(true, true);
    let vertices = 0;
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) vertices += m.geometry.attributes.position.count;
    });
    if (vertices > 40000) {
      g.add(new THREE.Box3Helper(new THREE.Box3().setFromObject(object), new THREE.Color("#566f87")));
      return g;
    }
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !o.visible) return;
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), mat);
      lines.matrixAutoUpdate = false;
      lines.matrix.copy(m.matrixWorld);
      lines.renderOrder = 999;
      g.add(lines);
    });
    return g;
  }, [object]);
  useEffect(() => () => group.traverse((o) => (o as THREE.LineSegments).geometry?.dispose()), [group]);
  return <primitive object={group} />;
}

// ------------------------------------------------------------------ camera

function Controls({
  id,
  tool,
  focusToken,
  sync,
  extraBounds,
}: {
  id: string;
  tool: Tool;
  focusToken: number;
  sync?: React.MutableRefObject<CameraSync>;
  extraBounds: THREE.Box3 | null;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const keys = useRef(new Set<string>());
  const seen = useRef(-1);
  const get = useThree((s) => s.get);

  useEffect(() => {
    const typing = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    };
    const down = (e: KeyboardEvent) => !typing() && keys.current.add(e.key.toLowerCase());
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Frame the proposal (or the lot) whenever asked; in the block view, every proposal.
  useEffect(() => {
    const { scene, camera } = get();
    const target = scene.getObjectByName("Proposed_Building") ?? scene.getObjectByName("Lot");
    if (!target || !controls.current) return;
    const box = new THREE.Box3().setFromObject(target);
    if (extraBounds) box.union(extraBounds);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z, 40);
    controls.current.target.set(c.x, size.y * 0.3, c.z);
    camera.position.set(c.x + r * 1.7, Math.max(size.y * 1.2, 70), c.z + r * 2.1);
    controls.current.update();
  }, [focusToken, get]); // eslint-disable-line react-hooks/exhaustive-deps -- extraBounds is read when a new focus is requested

  // Side-by-side views: the view being dragged becomes the owner and publishes its camera.
  useEffect(() => {
    const c = controls.current;
    if (!c || !sync) return;
    const start = () => (sync.current.owner = id);
    const change = () => {
      if (sync.current.owner !== id) return;
      sync.current.pos.copy(c.object.position);
      sync.current.target.copy(c.target);
      sync.current.version += 1;
      seen.current = sync.current.version;
    };
    c.addEventListener("start", start);
    c.addEventListener("change", change);
    return () => {
      c.removeEventListener("start", start);
      c.removeEventListener("change", change);
    };
  }, [id, sync]);

  useFrame(({ camera }, dt) => {
    const c = controls.current;
    if (!c) return;
    if (sync && sync.current.owner !== id && sync.current.version !== seen.current) {
      seen.current = sync.current.version;
      camera.position.copy(sync.current.pos);
      c.target.copy(sync.current.target);
      c.update();
      return;
    }
    const k = keys.current;
    if (k.size === 0 || (sync && sync.current.owner !== id)) return;
    const speed = (k.has("shift") ? 220 : 70) * dt;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const move = new THREE.Vector3();
    if (k.has("w") || k.has("arrowup")) move.add(forward);
    if (k.has("s") || k.has("arrowdown")) move.sub(forward);
    if (k.has("d") || k.has("arrowright")) move.add(right);
    if (k.has("a") || k.has("arrowleft")) move.sub(right);
    if (k.has("e")) move.y += 1;
    if (k.has("q")) move.y -= 1;
    if (move.lengthSq() === 0) return;
    move.normalize().multiplyScalar(speed);
    camera.position.add(move);
    c.target.add(move);
    camera.position.y = Math.max(2, camera.position.y);
    c.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      maxPolarAngle={Math.PI / 2 - 0.02}
      minDistance={8}
      maxDistance={2500}
      screenSpacePanning={false}
      mouseButtons={{
        LEFT: tool === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
    />
  );
}
