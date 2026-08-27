import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useThemeColors } from './useThemeColors';

const PARTICLE_COUNT = 120;
const GROUP_COUNT = 20; // ~6 particles/group - small enough that a "lock"
// converges cleanly rather than reading as visual clutter.

/**
 * A soft radial-gradient sprite generated on an offscreen canvas - the
 * standard, well-established way to get round glowing points out of
 * THREE.PointsMaterial (which otherwise renders hard-edged squares)
 * without writing a custom fragment shader.
 */
function makeDotTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.65)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * The "signal terrain" - an oscilloscope-grid-as-landscape, its vertices
 * displaced each frame by layered sine waves (standing in for organic
 * noise without needing a shader or a noise library) and colored by
 * elevation via vertex colors, so wave crests lean toward the bright
 * accent and troughs fade toward the background - letting Bloom pick out
 * just the peaks.
 */
function Terrain({ accent, bg, reduceMotion }: { accent: THREE.Color; bg: THREE.Color; reduceMotion: boolean }) {
  const geoRef = useRef<THREE.PlaneGeometry>(null);
  const basePositions = useRef<Float32Array | null>(null);

  useEffect(() => {
    const geo = geoRef.current;
    if (!geo) return;
    basePositions.current = Float32Array.from(geo.attributes.position.array as ArrayLike<number>);
    const count = geo.attributes.position.count;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  }, []);

  useFrame((state) => {
    const geo = geoRef.current;
    const base = basePositions.current;
    if (!geo || !base) return;
    const t = reduceMotion ? 0 : state.clock.elapsedTime;
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const colorAttr = geo.attributes.color as THREE.BufferAttribute;

    // Dim/bright endpoints computed once per frame (not per-vertex) to
    // avoid allocating THREE.Color objects inside the hot loop below.
    // Deliberately a NARROW, muted range (max ~30% accent even at wave
    // peaks) rather than reaching full accent - this mesh is meant to
    // read as a barely-there texture in the background, not a bold grid.
    // The same narrow range is what keeps it looking right in BOTH themes:
    // dark Ledger's accent (#2ed9b3) has high green/blue channels on its
    // own, so blending it in at full strength read as near-white once
    // wireframe overdraw and Bloom stacked on top - a muted ceiling avoids
    // that regardless of which theme's accent is active.
    const dimR = bg.r + (accent.r - bg.r) * 0.04;
    const dimG = bg.g + (accent.g - bg.g) * 0.04;
    const dimB = bg.b + (accent.b - bg.b) * 0.04;
    const peakR = bg.r + (accent.r - bg.r) * 0.3;
    const peakG = bg.g + (accent.g - bg.g) * 0.3;
    const peakB = bg.b + (accent.b - bg.b) * 0.3;

    for (let i = 0; i < posAttr.count; i++) {
      const ix = i * 3;
      const x = base[ix];
      const y = base[ix + 1];
      const wave =
        Math.sin(x * 0.18 + t * 0.6) * 0.5 + Math.sin(y * 0.24 - t * 0.4) * 0.35 + Math.sin((x + y) * 0.12 + t * 0.25) * 0.4;
      posAttr.setZ(i, wave * 0.85);

      const e = Math.max(0, Math.min(1, (wave + 1.25) / 2.5));
      colorAttr.setXYZ(i, dimR + (peakR - dimR) * e, dimG + (peakG - dimG) * e, dimB + (peakB - dimB) * e);
    }
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  });

  return (
    <mesh rotation={[-Math.PI / 2.3, 0, 0]} position={[0, -3.2, -8]}>
      {/* Bigger than the visible frustum + a tight fog range (see the
          <fog> in SignalFieldScene) so the plane's actual rectangular
          edge is never what fades it out - fog handles that well before
          the geometry boundary would otherwise show as a hard border. */}
      <planeGeometry ref={geoRef} args={[70, 50, 44, 44]} />
      <meshBasicMaterial vertexColors wireframe transparent opacity={0.16} />
    </mesh>
  );
}

/** One radial-fan of line segments from a group's centroid to each of its
 * member particles - sits at opacity 0 until that group is the active
 * "signal lock" for a cycle (see ParticleField's useFrame below). */
function GroupBeams({
  centroid,
  memberPositions,
  color,
  opacityRef,
}: {
  centroid: THREE.Vector3;
  memberPositions: number[];
  color: THREE.Color;
  opacityRef: { current: number };
}) {
  const materialRef = useRef<THREE.LineBasicMaterial>(null);

  const positions = useMemo(() => {
    const memberCount = memberPositions.length / 3;
    const arr = new Float32Array(memberCount * 2 * 3);
    for (let i = 0; i < memberCount; i++) {
      const o = i * 6;
      arr[o] = centroid.x;
      arr[o + 1] = centroid.y;
      arr[o + 2] = centroid.z;
      arr[o + 3] = memberPositions[i * 3];
      arr[o + 4] = memberPositions[i * 3 + 1];
      arr[o + 5] = memberPositions[i * 3 + 2];
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(() => {
    if (materialRef.current) {
      materialRef.current.opacity = opacityRef.current;
      materialRef.current.color.copy(color);
    }
  });

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial ref={materialRef} transparent opacity={0} color={color} />
    </lineSegments>
  );
}

/** The document-chunk particle field, plus the recurring "signal lock"
 * cycle: every few seconds a random small group brightens, its beams
 * fade in toward its centroid, hold, then everything fades back to idle -
 * an ambient, ongoing visualization of retrieval finding signal in noise. */
function ParticleField({
  accent,
  highlight,
  bg,
  reduceMotion,
}: {
  accent: THREE.Color;
  highlight: THREE.Color;
  bg: THREE.Color;
  reduceMotion: boolean;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const dotTexture = useMemo(() => makeDotTexture(), []);

  const { positions, groups, centroids } = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 3 + Math.random() * 9;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = (Math.random() - 0.25) * 6 + 1.2;
      positions[i * 3 + 2] = -2 - Math.random() * 11;
    }

    const order = Array.from({ length: PARTICLE_COUNT }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const groups: number[][] = Array.from({ length: GROUP_COUNT }, () => []);
    order.forEach((idx, n) => groups[n % GROUP_COUNT].push(idx));

    const centroids = groups.map((idxs) => {
      const c = new THREE.Vector3();
      idxs.forEach((idx) => c.add(new THREE.Vector3(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2])));
      c.divideScalar(idxs.length || 1);
      return c;
    });

    return { positions, groups, centroids };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const colorAttr = useMemo(() => new Float32Array(PARTICLE_COUNT * 3), []);
  const groupActivity = useRef<Float32Array>(new Float32Array(GROUP_COUNT));
  // Plain objects (not state) so GroupBeams can read the live value each
  // frame via a stable reference, without triggering React re-renders for
  // an animation that runs every frame regardless.
  const groupOpacityRefs = useMemo(() => Array.from({ length: GROUP_COUNT }, () => ({ current: 0 })), []);
  const groupColorRefs = useMemo(() => Array.from({ length: GROUP_COUNT }, () => accent.clone()), [accent]);
  const cycle = useRef({
    activeGroup: -1,
    phase: 'idle' as 'idle' | 'rising' | 'holding' | 'falling',
    phaseStart: 0,
    nextTrigger: 1.5,
  });

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const c = cycle.current;

    if (!reduceMotion) {
      if (c.phase === 'idle' && t >= c.nextTrigger) {
        c.activeGroup = Math.floor(Math.random() * GROUP_COUNT);
        c.phase = 'rising';
        c.phaseStart = t;
      } else if (c.phase === 'rising' && t - c.phaseStart > 0.7) {
        c.phase = 'holding';
        c.phaseStart = t;
      } else if (c.phase === 'holding' && t - c.phaseStart > 1.0) {
        c.phase = 'falling';
        c.phaseStart = t;
      } else if (c.phase === 'falling' && t - c.phaseStart > 1.1) {
        c.phase = 'idle';
        c.activeGroup = -1;
        c.nextTrigger = t + 2.5 + Math.random() * 3.5;
      }
    }

    const target = c.phase === 'rising' || c.phase === 'holding' ? 1 : 0;
    for (let g = 0; g < GROUP_COUNT; g++) {
      const goal = g === c.activeGroup ? target : 0;
      groupActivity.current[g] += (goal - groupActivity.current[g]) * 0.07;
      // Verification-amber tint during the "holding" beat specifically -
      // echoes the same cyan-then-amber sequence citations use elsewhere.
      const towardHighlight = g === c.activeGroup && c.phase === 'holding' ? 0.45 : 0;
      groupColorRefs[g].copy(accent).lerp(highlight, towardHighlight);
      groupOpacityRefs[g].current = groupActivity.current[g] * 0.4;
    }

    // Slow ambient drift for the whole field - alive even between locks.
    if (pointsRef.current) {
      pointsRef.current.rotation.y = reduceMotion ? 0 : Math.sin(t * 0.03) * 0.09;
      pointsRef.current.rotation.x = reduceMotion ? 0 : Math.cos(t * 0.025) * 0.03;
    }

    groups.forEach((idxs, g) => {
      const a = groupActivity.current[g];
      idxs.forEach((idx) => {
        // Idle particles sit much closer to the background (0.08) than
        // before - the "document field" should read as barely-there
        // texture until a group actually locks on, at which point it
        // still climbs to a clearly-visible peak (0.9) so the signal-lock
        // moment reads as a genuine event against the muted field.
        colorAttr[idx * 3] = bg.r + (groupColorRefs[g].r - bg.r) * (0.08 + a * 0.82);
        colorAttr[idx * 3 + 1] = bg.g + (groupColorRefs[g].g - bg.g) * (0.08 + a * 0.82);
        colorAttr[idx * 3 + 2] = bg.b + (groupColorRefs[g].b - bg.b) * (0.08 + a * 0.82);
      });
    });

    if (pointsRef.current) {
      const attr = pointsRef.current.geometry.attributes.color as THREE.BufferAttribute | undefined;
      if (attr) attr.needsUpdate = true;
    }
  });

  return (
    <>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colorAttr, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.16}
          map={dotTexture}
          vertexColors
          transparent
          opacity={0.9}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>
      {groups.map((idxs, g) => (
        <GroupBeams
          key={g}
          centroid={centroids[g]}
          memberPositions={idxs.flatMap((idx) => [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]])}
          color={groupColorRefs[g]}
          opacityRef={groupOpacityRefs[g]}
        />
      ))}
    </>
  );
}

/** Subtle camera drift toward the cursor - the same depth cue the old 2D
 * orb had, just genuinely three-dimensional now. */
function CameraRig({ reduceMotion }: { reduceMotion: boolean }) {
  useFrame((state) => {
    if (reduceMotion) return;
    const { pointer, camera } = state;
    camera.position.x += (pointer.x * 1.1 - camera.position.x) * 0.02;
    camera.position.y += (1.2 - pointer.y * 0.5 - camera.position.y) * 0.02;
    camera.lookAt(0, 0.4, -6);
  });
  return null;
}

export function SignalFieldScene({ reduceMotion, paused }: { reduceMotion: boolean; paused: boolean }) {
  const { accent, highlight, bg } = useThemeColors();

  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      camera={{ position: [0, 1.2, 6], fov: 45, near: 0.1, far: 60 }}
      frameloop={paused ? 'never' : 'always'}
    >
      <fog attach="fog" args={[bg, 5, 13]} />
      <Terrain accent={accent} bg={bg} reduceMotion={reduceMotion} />
      <ParticleField accent={accent} highlight={highlight} bg={bg} reduceMotion={reduceMotion} />
      <CameraRig reduceMotion={reduceMotion} />
      <EffectComposer>
        {/* A high threshold + modest intensity on purpose: only a
            genuinely bright moment (a particle group near full "signal
            lock" activity, boosted further by additive blending) should
            ever bloom. The terrain's muted colors (see Terrain's dim/peak
            mix above) stay well under this threshold in both themes, so
            it never washes out toward white the way the original, much
            brighter/lower-threshold version did in dark mode. */}
        <Bloom luminanceThreshold={0.62} luminanceSmoothing={0.9} intensity={0.55} />
      </EffectComposer>
    </Canvas>
  );
}
