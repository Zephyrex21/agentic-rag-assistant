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
function Terrain({
  accent,
  highlight,
  bg,
  reduceMotion,
  isDark,
}: {
  accent: THREE.Color;
  highlight: THREE.Color;
  bg: THREE.Color;
  reduceMotion: boolean;
  isDark: boolean;
}) {
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
    // Deliberately DIFFERENT ranges per theme, not one universal formula:
    // dark Ledger's accent (#2ed9b3) has high green/blue channels and a
    // high raw luminance on its own, so blending it in at the same
    // strength that looks right in light mode reads as near-white once
    // wireframe overdraw and Bloom stack on top. Light Ledger's accent
    // (#0e6b57) is a much darker, lower-luminance teal that can take a
    // full-strength blend without ever washing out the same way.
    const dimMix = isDark ? 0.07 : 0.22;
    const peakMix = isDark ? 0.42 : 1.0;
    const dimR = bg.r + (accent.r - bg.r) * dimMix;
    const dimG = bg.g + (accent.g - bg.g) * dimMix;
    const dimB = bg.b + (accent.b - bg.b) * dimMix;
    const peakR = bg.r + (accent.r - bg.r) * peakMix;
    const peakG = bg.g + (accent.g - bg.g) * peakMix;
    const peakB = bg.b + (accent.b - bg.b) * peakMix;
    // A small warm highlight fleck blended in only at the very highest
    // crests - echoes the amber "verification" accent the particles use
    // during their own peak moment, giving the terrain a second color
    // note instead of reading as a flat single-hue grid.
    const glintMix = isDark ? 0.22 : 0.35;

    for (let i = 0; i < posAttr.count; i++) {
      const ix = i * 3;
      const x = base[ix];
      const y = base[ix + 1];
      // Multi-octave: a slow broad swell plus two faster, smaller ripples
      // running at different angles - reads as genuine rolling terrain
      // rather than one uniform wave, and the added amplitude/speed here
      // (vs. the original) makes the motion unmistakable at a glance.
      const swell = Math.sin(x * 0.1 + t * 0.35) * 0.6 + Math.cos(y * 0.13 - t * 0.28) * 0.5;
      const ripple = Math.sin(x * 0.26 + y * 0.19 + t * 0.9) * 0.4 + Math.sin(x * 0.34 - y * 0.22 - t * 0.7) * 0.3;
      const wave = swell + ripple;
      posAttr.setZ(i, wave * 1.05);

      const e = Math.max(0, Math.min(1, (wave + 1.8) / 3.6));
      let r = dimR + (peakR - dimR) * e;
      let g = dimG + (peakG - dimG) * e;
      let b = dimB + (peakB - dimB) * e;
      // Only the top slice of crests (e > 0.82) pick up the warm glint,
      // scaled by how far past that point they are - keeps it an accent,
      // not a wash over the whole peak region.
      if (e > 0.82) {
        const glintT = ((e - 0.82) / 0.18) * glintMix;
        r += (highlight.r - r) * glintT;
        g += (highlight.g - g) * glintT;
        b += (highlight.b - b) * glintT;
      }
      colorAttr.setXYZ(i, r, g, b);
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
      {/* Opacity also differs per theme for the same reason the color mix
          does - dark mode needs to stay lower to avoid washing out. */}
      <meshBasicMaterial vertexColors wireframe transparent opacity={isDark ? 0.3 : 0.5} />
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
      const a = opacityRef.current / 0.75; // normalize back to 0..1 activity
      materialRef.current.opacity = opacityRef.current;
      // Same over-bright boost as the particle points - a beam needs
      // genuine HDR-range brightness to clear Bloom's threshold and
      // actually glow during the "lock" moment, not just look opaque.
      materialRef.current.color.copy(color).multiplyScalar(1 + a * 0.9);
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
  isDark,
}: {
  accent: THREE.Color;
  highlight: THREE.Color;
  bg: THREE.Color;
  reduceMotion: boolean;
  isDark: boolean;
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
      // Same over-bright logic as the particle colors below - a beam at
      // full activity needs to clear the Bloom threshold to actually
      // glow, not just look "a bit brighter than transparent".
      groupOpacityRefs[g].current = groupActivity.current[g] * 0.75;
    }

    // Slow ambient drift for the whole field - alive even between locks.
    if (pointsRef.current) {
      pointsRef.current.rotation.y = reduceMotion ? 0 : Math.sin(t * 0.03) * 0.09;
      pointsRef.current.rotation.x = reduceMotion ? 0 : Math.cos(t * 0.025) * 0.03;
    }

    groups.forEach((idxs, g) => {
      const a = groupActivity.current[g];
      // An "over-bright" boost applied only as activity climbs - at a=0
      // this is 1 (no change to the normal idle color), at a=1 it scales
      // the final color up to ~1.9x, deliberately pushing RGB values past
      // the normal 0..1 range. This is what makes Bloom actually trigger
      // reliably on a signal-lock: a luminance threshold that's high
      // enough to leave the idle field and the terrain alone (see their
      // much lower base mixes) needs a genuinely bright signal to clear
      // it, and a natural-range color mix alone was landing just under
      // that line. Combined with AdditiveBlending on the points material
      // below, overlapping boosted particles in an active cluster read as
      // a clear, glowing "lock" rather than a barely-brighter dot.
      const boost = 1 + a * 0.9;
      idxs.forEach((idx) => {
        // Idle mix is theme-aware for the same reason Terrain's is - dark
        // mode's brighter accent needs a lower floor to read as "barely
        // there" rather than washing out; light mode's darker accent can
        // sit higher (closer to the original look) without that risk.
        // The signal-lock peak (a=1) stays strong either way so the
        // "lock" moment always reads as a clear event.
        const idleMix = isDark ? 0.06 : 0.16;
        const peakMix = isDark ? 0.82 : 0.84;
        const mixed = idleMix + a * peakMix;
        colorAttr[idx * 3] = (bg.r + (groupColorRefs[g].r - bg.r) * mixed) * boost;
        colorAttr[idx * 3 + 1] = (bg.g + (groupColorRefs[g].g - bg.g) * mixed) * boost;
        colorAttr[idx * 3 + 2] = (bg.b + (groupColorRefs[g].b - bg.b) * mixed) * boost;
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
  const { accent, highlight, bg, isDark } = useThemeColors();

  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      camera={{ position: [0, 1.2, 6], fov: 45, near: 0.1, far: 60 }}
      frameloop={paused ? 'never' : 'always'}
    >
      <fog attach="fog" args={[bg, 5, 13]} />
      <Terrain accent={accent} highlight={highlight} bg={bg} reduceMotion={reduceMotion} isDark={isDark} />
      <ParticleField accent={accent} highlight={highlight} bg={bg} reduceMotion={reduceMotion} isDark={isDark} />
      <CameraRig reduceMotion={reduceMotion} />
      <EffectComposer>
        {/* Threshold/intensity tuned against the "over-bright boost" the
            particle/beam materials apply during an active signal-lock
            (see ParticleField/GroupBeams above) - idle particles and the
            terrain both stay comfortably under this in both themes, while
            a boosted, near-1.9x-bright active cluster clears it cleanly,
            so the glow reliably shows up exactly when a "lock" happens
            and nowhere else. */}
        <Bloom luminanceThreshold={0.5} luminanceSmoothing={0.85} intensity={0.85} />
      </EffectComposer>
    </Canvas>
  );
}
