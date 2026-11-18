import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import coastlinesRaw from '../assets/coastlines-110m.json';
import landPointsRaw from '../assets/land-points-110m.json';
import type { RuntimeCapabilities } from '../types/geoint';

interface GlobeHeroProps {
  capabilities: RuntimeCapabilities;
  transitioning: boolean;
  onActiveTargetChange?: (target: { label: string; lat: number; lon: number }) => void;
}

const PROBE_TARGETS = [
  { label: 'LISBON · PT', lat: 38.6916, lon: -9.216 },
  { label: 'PARIS · FR', lat: 48.8584, lon: 2.2945 },
  { label: 'TOKYO · JP', lat: 35.6595, lon: 139.7004 },
  { label: 'SAN FRANCISCO · US', lat: 37.8199, lon: -122.4783 },
  { label: 'RIO DE JANEIRO · BR', lat: -22.949, lon: -43.1546 },
  { label: 'CAPE TOWN · ZA', lat: -33.9628, lon: 18.4098 },
];

function latLonToVec3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

const FallbackSvgGlobe: React.FC<{ transitioning: boolean }> = ({ transitioning }) => {
  const paths = (coastlinesRaw as Array<Array<[number, number]>>)
    .map((line) =>
      line
        .map(([lon, lat], idx) => {
          const x = ((lon + 180) / 360) * 1000;
          const y = ((90 - lat) / 180) * 500;
          return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ')
    )
    .join(' ');

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingRight: '4vw',
        opacity: transitioning ? 0 : 0.85,
        transform: transitioning ? 'scale(1.18)' : 'scale(1)',
        transition: 'opacity 0.45s ease, transform 0.55s ease',
      }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 1000 500"
        style={{ width: 'min(92vw, 940px)', height: 'auto', opacity: 0.42 }}
      >
        <path d={paths} fill="none" stroke="#64748b" strokeWidth="0.9" />
        {PROBE_TARGETS.map((t) => {
          const x = ((t.lon + 180) / 360) * 1000;
          const y = ((90 - t.lat) / 180) * 500;
          return (
            <g key={t.label}>
              <circle cx={x} cy={y} r="4.5" fill="none" stroke="#38bdf8" strokeWidth="1" opacity="0.7" />
              <circle cx={x} cy={y} r="2" fill="#38bdf8" />
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export const GlobeHero: React.FC<GlobeHeroProps> = ({
  capabilities,
  transitioning,
  onActiveTargetChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const transitioningRef = useRef(transitioning);
  useEffect(() => {
    transitioningRef.current = transitioning;
  }, [transitioning]);

  useEffect(() => {
    if (!capabilities.webgl) {
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      queueMicrotask(() => setWebglFailed(true));
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      38,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      100
    );

    const isMobile = container.clientWidth < 920;
    const baseCameraX = isMobile ? 0 : -0.55;
    const baseCameraY = isMobile ? -0.15 : 0.14;
    const baseCameraZ = isMobile ? 3.55 : 3.05;
    camera.position.set(baseCameraX, baseCameraY, baseCameraZ);

    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    // 1. Core dark planetary body with subtle radial terminator lighting
    const sphereGeo = new THREE.SphereGeometry(1, 64, 64);
    const sphereMat = new THREE.ShaderMaterial({
      uniforms: {
        uLightDir: { value: new THREE.Vector3(0.65, 0.45, 0.6).normalize() },
      },
      vertexShader: `
        varying vec3 vNormalWorld;
        varying vec3 vViewDir;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vNormalWorld = normalize(mat3(modelMatrix) * normal);
          vViewDir = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uLightDir;
        varying vec3 vNormalWorld;
        varying vec3 vViewDir;
        void main() {
          float ndl = max(dot(vNormalWorld, uLightDir), 0.0);
          float rim = 1.0 - max(dot(vNormalWorld, vViewDir), 0.0);
          vec3 night = vec3(0.022, 0.032, 0.052);
          vec3 lit = vec3(0.055, 0.088, 0.142);
          vec3 col = mix(night, lit, pow(ndl, 1.35) * 0.85);
          col += vec3(0.14, 0.46, 0.72) * pow(rim, 3.6) * 0.28;
          gl_FragColor = vec4(col, 0.98);
        }
      `,
    });
    const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
    globeGroup.add(sphereMesh);

    // 2. Atmospheric Fresnel rim shell
    const atmosGeo = new THREE.SphereGeometry(1.11, 48, 48);
    const atmosMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float intensity = pow(0.66 - dot(vNormal, vViewDir), 3.4);
          gl_FragColor = vec4(0.22, 0.74, 0.97, 1.0) * max(intensity, 0.0) * 0.55;
        }
      `,
    });
    const atmosMesh = new THREE.Mesh(atmosGeo, atmosMat);
    scene.add(atmosMesh);

    // 3. Subtle spherical coordinate graticule
    const gratPositions: number[] = [];
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lon = -180; lon < 180; lon += 6) {
        const a = latLonToVec3(lat, lon, 1.002);
        const b = latLonToVec3(lat, lon + 6, 1.002);
        gratPositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    for (let lon = -180; lon < 180; lon += 30) {
      for (let lat = -84; lat < 84; lat += 6) {
        const a = latLonToVec3(lat, lon, 1.002);
        const b = latLonToVec3(lat + 6, lon, 1.002);
        gratPositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const gratGeo = new THREE.BufferGeometry();
    gratGeo.setAttribute('position', new THREE.Float32BufferAttribute(gratPositions, 3));
    const gratMat = new THREE.LineBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.075,
    });
    const gratLines = new THREE.LineSegments(gratGeo, gratMat);
    globeGroup.add(gratLines);

    // 4. Natural Earth 110m Coastline Vectors
    const coastPositions: number[] = [];
    for (const ring of coastlinesRaw as Array<Array<[number, number]>>) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = latLonToVec3(ring[i][1], ring[i][0], 1.004);
        const b = latLonToVec3(ring[i + 1][1], ring[i + 1][0], 1.004);
        coastPositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const coastGeo = new THREE.BufferGeometry();
    coastGeo.setAttribute('position', new THREE.Float32BufferAttribute(coastPositions, 3));
    const coastMat = new THREE.LineBasicMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.34,
    });
    const coastLines = new THREE.LineSegments(coastGeo, coastMat);
    globeGroup.add(coastLines);

    // 5. Natural Earth Landmass Fibonacci Point Lattice (4,043 points)
    const landCoords = landPointsRaw as Array<[number, number]>;
    const landPositions = new Float32Array(landCoords.length * 3);
    for (let i = 0; i < landCoords.length; i++) {
      const v = latLonToVec3(landCoords[i][1], landCoords[i][0], 1.005);
      landPositions[i * 3] = v.x;
      landPositions[i * 3 + 1] = v.y;
      landPositions[i * 3 + 2] = v.z;
    }
    const landGeo = new THREE.BufferGeometry();
    landGeo.setAttribute('position', new THREE.BufferAttribute(landPositions, 3));
    const landMat = new THREE.PointsMaterial({
      color: 0xe2e8f0,
      size: 0.011,
      transparent: true,
      opacity: 0.42,
      sizeAttenuation: true,
    });
    const landPoints = new THREE.Points(landGeo, landMat);
    globeGroup.add(landPoints);

    // 6. Geolocation Probe Beacons & Geodesic Investigation Arcs
    const beaconGroup = new THREE.Group();
    globeGroup.add(beaconGroup);

    const beaconMeshes: THREE.Mesh[] = [];
    const ringMeshes: THREE.Mesh[] = [];
    const probeGeo = new THREE.SphereGeometry(0.013, 12, 12);
    const ringGeo = new THREE.RingGeometry(0.018, 0.025, 24);

    for (const target of PROBE_TARGETS) {
      const pos = latLonToVec3(target.lat, target.lon, 1.012);
      const probeMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      const probe = new THREE.Mesh(probeGeo, probeMat);
      probe.position.copy(pos);
      beaconGroup.add(probe);
      beaconMeshes.push(probe);

      const rMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.65,
      });
      const ring = new THREE.Mesh(ringGeo, rMat);
      ring.position.copy(pos);
      ring.lookAt(pos.clone().multiplyScalar(2));
      beaconGroup.add(ring);
      ringMeshes.push(ring);
    }

    // Build geodesic arcs between consecutive investigation targets
    const arcLines: THREE.Line[] = [];
    for (let i = 0; i < PROBE_TARGETS.length; i++) {
      const a = latLonToVec3(PROBE_TARGETS[i].lat, PROBE_TARGETS[i].lon, 1.012).normalize();
      const next = PROBE_TARGETS[(i + 1) % PROBE_TARGETS.length];
      const b = latLonToVec3(next.lat, next.lon, 1.012).normalize();
      const arcPts: THREE.Vector3[] = [];
      const steps = 48;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const v = new THREE.Vector3().lerpVectors(a, b, t).normalize();
        const lift = 1.012 + Math.sin(Math.PI * t) * 0.16;
        arcPts.push(v.multiplyScalar(lift));
      }
      const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
      const arcMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: i === 0 ? 0.55 : 0.14,
      });
      const arc = new THREE.Line(arcGeo, arcMat);
      beaconGroup.add(arc);
      arcLines.push(arc);
    }

    // Initial globe orientation focused toward Europe / Atlantic
    globeGroup.rotation.y = -0.35;
    globeGroup.rotation.x = 0.42;

    let targetMouseX = 0;
    let targetMouseY = 0;
    let currentMouseX = 0;
    let currentMouseY = 0;

    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      targetMouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.45;
      targetMouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 0.25;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const onResize = () => {
      if (!container) return;
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    // Pause animation loop when offscreen or hidden
    let isVisible = true;
    const observer = new IntersectionObserver(
      (entries) => {
        isVisible = entries.some((e) => e.isIntersecting);
      },
      { threshold: 0.05 }
    );
    observer.observe(container);

    const onVisibilityChange = () => {
      isVisible = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    let rafId = 0;
    let lastTime = performance.now();
    let elapsed = 0;
    let activeIdx = -1;
    let transitionProgress = 0;

    const renderFrame = (now: number) => {
      rafId = requestAnimationFrame(renderFrame);
      if (!isVisible) {
        lastTime = now;
        return;
      }

      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      if (!capabilities.reducedMotion) {
        elapsed += dt;
        globeGroup.rotation.y += dt * 0.085;
      }

      // Smooth cursor damping
      currentMouseX += (targetMouseX - currentMouseX) * 0.06;
      currentMouseY += (targetMouseY - currentMouseY) * 0.06;
      globeGroup.rotation.x = 0.42 + currentMouseY * 0.5;
      globeGroup.position.x = -currentMouseX * 0.08;

      // Cycle active geolocation arc/beacon every 3.4s
      const nextIdx = Math.floor(elapsed / 3.4) % PROBE_TARGETS.length;
      if (nextIdx !== activeIdx) {
        activeIdx = nextIdx;
        onActiveTargetChange?.(PROBE_TARGETS[activeIdx]);
      }

      for (let i = 0; i < PROBE_TARGETS.length; i++) {
        const isActive = i === activeIdx;
        const pulse = 1 + (isActive ? 0.55 * Math.sin(elapsed * 4.2) : 0);
        ringMeshes[i].scale.setScalar(isActive ? 1.15 + ((elapsed * 1.1) % 1) * 1.1 : 0.85);
        (ringMeshes[i].material as THREE.MeshBasicMaterial).opacity = isActive
          ? Math.max(0.05, 0.72 * (1 - ((elapsed * 1.1) % 1)))
          : 0.16;
        beaconMeshes[i].scale.setScalar(isActive ? 1.25 * pulse : 0.8);
        (arcLines[i].material as THREE.LineBasicMaterial).opacity = isActive ? 0.62 : 0.11;
      }

      // Smooth transition zoom into surface when entering workspace
      if (transitioningRef.current) {
        transitionProgress = Math.min(1, transitionProgress + dt * 2.2);
        const eased = 1 - Math.pow(1 - transitionProgress, 3);
        camera.position.set(
          baseCameraX * (1 - eased),
          baseCameraY * (1 - eased),
          baseCameraZ - eased * 1.75
        );
      } else {
        transitionProgress = 0;
        camera.position.set(baseCameraX, baseCameraY, baseCameraZ);
      }

      renderer.render(scene, camera);
    };

    rafId = requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('resize', onResize);

      sphereGeo.dispose();
      sphereMat.dispose();
      atmosGeo.dispose();
      atmosMat.dispose();
      gratGeo.dispose();
      gratMat.dispose();
      coastGeo.dispose();
      coastMat.dispose();
      landGeo.dispose();
      landMat.dispose();
      probeGeo.dispose();
      ringGeo.dispose();
      beaconMeshes.forEach((m) => (m.material as THREE.Material).dispose());
      ringMeshes.forEach((m) => (m.material as THREE.Material).dispose());
      arcLines.forEach((l) => {
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [capabilities.webgl, capabilities.reducedMotion, onActiveTargetChange]);

  if (webglFailed || !capabilities.webgl) {
    return <FallbackSvgGlobe transitioning={transitioning} />;
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        touchAction: 'pan-y',
        opacity: transitioning ? 0 : 1,
        transition: 'opacity 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      aria-hidden="true"
    />
  );
};
