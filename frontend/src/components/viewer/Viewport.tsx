"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, Grid, Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { hasAncestor, isOnSite, isProposed, selectableAncestor } from "@/lib/scene";
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
}

const CANVAS = "#edf0ef";

export default function Viewport(props: ViewportProps) {
  const night = !props.sun.up;
  return (
    <Canvas
      shadows="percentage"
      camera={{ position: [170, 150, 210], fov: 40, near: 0.5, far: 6000 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
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
      </Suspense>
      {props.heatmap && <Heatmap {...props.heatmap} />}
      <Controls id={props.id} tool={props.tool} focusToken={props.focusToken} sync={props.sync} />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={["#727773", "#727773", "#566f87"]} labelColor="#ffffff" axisHeadScale={0.8} />
      </GizmoHelper>
      {process.env.NODE_ENV === "development" && props.id === "main" && <DebugHandle />}
    </Canvas>
  );
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

function Model({ id, glbUrl, showProposal, hidden, selectedId, onSelect, onLoaded, layers, tool, annotation }: ViewportProps) {
  const { scene: original } = useGLTF(glbUrl);
  // Each view gets its own copy so two canvases can show the same scene.
  const scene = useMemo(() => original.clone(true), [original]);

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

  useEffect(() => {
    scene.traverse((o) => {
      if (o === scene) return;
      let visible = !hidden.has(o.name);
      if (isProposed(o)) visible &&= showProposal;
      if (isOnSite(o)) visible &&= !showProposal;
      if (o.name === "Existing_Buildings") visible &&= layers.context;
      if (o.name === "Street_Trees") visible &&= layers.trees;
      if (o.name === "Parcels") visible &&= layers.lots;
      o.visible = visible;
    });
  }, [scene, showProposal, hidden, layers]);

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
      {annotation && showProposal && proposalTop && (
        <Html position={proposalTop} center zIndexRange={[20, 0]}>
          <div className="pointer-events-none flex items-center gap-2.5 whitespace-nowrap rounded-md border border-prop bg-white px-3 py-2 text-[11px] text-prop-ink shadow-sm">
            <span className="size-[7px] bg-prop-ink" />
            {annotation}
          </div>
        </Html>
      )}
    </>
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

function Controls({ id, tool, focusToken, sync }: { id: string; tool: Tool; focusToken: number; sync?: React.MutableRefObject<CameraSync> }) {
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

  // Frame the proposal (or the lot) whenever asked.
  useEffect(() => {
    const { scene, camera } = get();
    const target = scene.getObjectByName("Proposed_Building") ?? scene.getObjectByName("Lot");
    if (!target || !controls.current) return;
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z, 40);
    controls.current.target.set(c.x, size.y * 0.3, c.z);
    camera.position.set(c.x + r * 1.7, Math.max(size.y * 1.2, 70), c.z + r * 2.1);
    controls.current.update();
  }, [focusToken, get]);

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
