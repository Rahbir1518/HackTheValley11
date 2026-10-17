"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, Grid, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { isOnSite, isProposed, selectableAncestor } from "@/lib/scene";
import type { Sun } from "@/lib/sun";

export interface ViewportProps {
  glbUrl: string | null;
  showProposal: boolean;
  hidden: Set<string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onLoaded: (root: THREE.Object3D) => void;
  sun: Sun;
  shadows: boolean;
  showGrid: boolean;
  focusToken: number; // bump to re-frame the camera on the proposal
}

export default function Viewport(props: ViewportProps) {
  const sky = props.sun.up ? skyColour(props.sun.altitudeDeg) : "#1a1d24";
  return (
    <Canvas
      shadows="percentage"
      camera={{ position: [180, 160, 220], fov: 45, near: 0.5, far: 6000 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <color attach="background" args={[sky]} />
      <fog attach="fog" args={[sky, 900, 2200]} />
      <SunLight sun={props.sun} shadows={props.shadows} />
      {props.showGrid && (
        <Grid
          position={[0, 0.02, 0]}
          infiniteGrid
          cellSize={10}
          sectionSize={50}
          cellColor="#5d5d5d"
          sectionColor="#7a7a7a"
          fadeDistance={900}
          cellThickness={0.6}
          sectionThickness={1}
        />
      )}
      <Suspense fallback={null}>{props.glbUrl && <Model {...props} glbUrl={props.glbUrl} />}</Suspense>
      <Controls focusToken={props.focusToken} />
      {process.env.NODE_ENV === "development" && <DebugHandle />}
      <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
        <GizmoViewport axisColors={["#e0524a", "#7cc44a", "#4a8fe0"]} labelColor="#111" />
      </GizmoHelper>
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

function skyColour(alt: number) {
  // Warm near the horizon, cool blue-grey at height.
  const t = Math.min(1, Math.max(0, alt / 35));
  return new THREE.Color("#d9a27a").lerp(new THREE.Color("#a9bccd"), t).getStyle();
}

// ------------------------------------------------------------------ sun

function SunLight({ sun, shadows }: { sun: Sun; shadows: boolean }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const [x, y, z] = sun.direction;
  const intensity = sun.up ? 2.2 + 2.6 * Math.min(1, sun.altitudeDeg / 30) : 0;
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
      <hemisphereLight args={["#e8eef5", "#5a5a58", sun.up ? 1.1 : 0.35]} />
      <directionalLight
        ref={light}
        position={[x * 1000, Math.max(y, 0.02) * 1000, z * 1000]}
        intensity={intensity}
        color={sun.altitudeDeg < 8 ? "#ffcf9f" : "#fff7ec"}
        castShadow={shadows && sun.up}
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
      />
    </>
  );
}

// ------------------------------------------------------------------ model

function Model({ glbUrl, showProposal, hidden, selectedId, onSelect, onLoaded }: ViewportProps & { glbUrl: string }) {
  const { scene } = useGLTF(glbUrl);

  useEffect(() => {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const ground = o.parent?.name === "Ground" || o.name.startsWith("Ground") || o.name.startsWith("Parcels");
      mesh.castShadow = !ground;
      mesh.receiveShadow = true;
    });
    onLoaded(scene);
  }, [scene, onLoaded]);

  // Visibility: with/without proposal, plus per-object toggles from the Hierarchy.
  useEffect(() => {
    scene.traverse((o) => {
      if (o === scene) return;
      let visible = !hidden.has(o.uuid);
      if (isProposed(o)) visible &&= showProposal;
      if (isOnSite(o)) visible &&= !showProposal;
      o.visible = visible;
    });
  }, [scene, showProposal, hidden]);

  const selected = useMemo(() => (selectedId ? scene.getObjectByProperty("uuid", selectedId) ?? null : null), [scene, selectedId]);

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const target = selectableAncestor(e.object);
    onSelect(target ? target.uuid : null);
  };

  return (
    <>
      <primitive object={scene} onClick={click} />
      {selected && <SelectionOutline object={selected} />}
    </>
  );
}

/** Orange edge outline for the selected object (box outline for large merged meshes). */
function SelectionOutline({ object }: { object: THREE.Object3D }) {
  const group = useMemo(() => {
    const g = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: "#f26b1d", depthTest: false, transparent: true, opacity: 0.95 });
    object.updateWorldMatrix(true, true);
    let vertices = 0;
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) vertices += m.geometry.attributes.position.count;
    });
    if (vertices > 40000) {
      const box = new THREE.Box3Helper(new THREE.Box3().setFromObject(object), new THREE.Color("#f26b1d"));
      g.add(box);
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

// ------------------------------------------------------------------ camera controls

/** Orbit/pan/zoom with the mouse, plus Unity-style WASD/QE flying (hold Shift to go faster). */
function Controls({ focusToken }: { focusToken: number }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const keys = useRef(new Set<string>());
  const get = useThree((s) => s.get);

  useEffect(() => {
    const typing = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    };
    const down = (e: KeyboardEvent) => {
      if (!typing()) keys.current.add(e.key.toLowerCase());
    };
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

  // Frame the proposal (or the whole site) when a new scene loads.
  useEffect(() => {
    const { scene, camera } = get();
    const target = scene.getObjectByName("Proposed_Building") ?? scene.getObjectByName("Lot");
    if (!target || !controls.current) return;
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z, 40);
    controls.current.target.set(centre.x, size.y * 0.35, centre.z);
    camera.position.set(centre.x + r * 1.6, Math.max(size.y * 1.1, 60), centre.z + r * 2.0);
    controls.current.update();
  }, [focusToken, get]);

  useFrame(({ camera }, dt) => {
    const k = keys.current;
    const c = controls.current;
    if (!c || k.size === 0) return;
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
    if (camera.position.y < 2) {
      const lift = 2 - camera.position.y;
      camera.position.y += lift;
      c.target.y += lift;
    }
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
    />
  );
}
