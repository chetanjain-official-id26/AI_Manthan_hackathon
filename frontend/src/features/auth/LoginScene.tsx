import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Decorative WebGL backdrop for the login showcase panel: a slow particle field with floating
 * policy-decision receipt cards (✓ approve, ⚑ route, ✕ reject) and gentle mouse parallax.
 * Loaded lazily, desktop only; see `canRunLoginScene` for the fallbacks.
 */

const CARD_KINDS = [
  { sym: '✓', label: 'AUTO-APPROVE', color: '#34d399' },
  { sym: '⚑', label: 'ROUTE', color: '#fbbf24' },
  { sym: '✕', label: 'RECEIPT REQ.', color: '#f87171' },
] as const;

function cardTexture(kind: (typeof CARD_KINDS)[number], amount: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 340;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = 'rgba(15,23,42,0.85)';
    g.strokeStyle = 'rgba(148,163,184,0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(4, 4, 248, 332, 22);
    g.fill();
    g.stroke();
    g.fillStyle = kind.color;
    g.fillRect(4, 4, 248, 10);
    g.fillStyle = 'rgba(226,232,240,0.9)';
    g.font = '600 22px Inter, system-ui, sans-serif';
    g.fillText('RECEIPT', 28, 62);
    g.fillStyle = 'rgba(148,163,184,0.55)';
    for (let i = 0; i < 4; i += 1) g.fillRect(28, 92 + i * 26, 140 + ((i * 37) % 60), 8);
    g.fillStyle = '#f8fafc';
    g.font = '700 34px Inter, system-ui, sans-serif';
    g.fillText(`₹${amount}`, 28, 232);
    g.fillStyle = kind.color;
    g.font = '700 46px system-ui, sans-serif';
    g.fillText(kind.sym, 28, 304);
    g.font = '600 18px Inter, system-ui, sans-serif';
    g.fillText(kind.label, 78, 296);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export default function LoginScene() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      return; // no WebGL: the static gradient stays
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x020617, 8, 22);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 12);

    // ---- particle field
    const COUNT = 1400;
    const pos = new Float32Array(COUNT * 3);
    const col = new Float32Array(COUNT * 3);
    const palette = [new THREE.Color('#818cf8'), new THREE.Color('#38bdf8'), new THREE.Color('#a78bfa'), new THREE.Color('#e2e8f0')];
    for (let i = 0; i < COUNT; i += 1) {
      pos[i * 3] = (Math.random() - 0.5) * 26;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 18;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 16 - 2;
      const pc = palette[i % palette.length] as THREE.Color;
      col[i * 3] = pc.r;
      col[i * 3 + 1] = pc.g;
      col[i * 3 + 2] = pc.b;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pMat = new THREE.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(pGeo, pMat);
    scene.add(points);

    // ---- floating receipt cards
    const cardGeo = new THREE.PlaneGeometry(1.5, 2);
    const textures: THREE.Texture[] = [];
    const materials: THREE.Material[] = [];
    const cards: { mesh: THREE.Mesh; speed: number; spin: number; sway: number; phase: number }[] = [];
    const amounts = ['1,200.00', '650.00', '9,000.00', '4,500.00', '18,250.00', '2,000.00', '760.00', '1,499.99'];
    for (let i = 0; i < 12; i += 1) {
      const kind = CARD_KINDS[i % CARD_KINDS.length] as (typeof CARD_KINDS)[number];
      const tex = cardTexture(kind, amounts[i % amounts.length] as string);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
      textures.push(tex);
      materials.push(mat);
      const mesh = new THREE.Mesh(cardGeo, mat);
      mesh.position.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 14, -Math.random() * 8 - 1);
      mesh.rotation.set((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.4);
      scene.add(mesh);
      cards.push({ mesh, speed: 0.25 + Math.random() * 0.35, spin: (Math.random() - 0.5) * 0.25, sway: 0.2 + Math.random() * 0.4, phase: Math.random() * Math.PI * 2 });
    }

    // ---- sizing, parallax, visibility
    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const target = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      target.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      target.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    const clock = new THREE.Clock();
    let raf = 0;
    let last = 0;
    // Performance guard: on software rendering / weak GPUs, give up and keep the static panel.
    let probeStart = 0;
    let probeFrames = 0;
    let probing = true;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (probing) {
        if (!probeStart) probeStart = now;
        probeFrames += 1;
        if (now - probeStart > 2500) {
          probing = false;
          if ((probeFrames * 1000) / (now - probeStart) < 15) {
            stop();
            renderer.domElement.style.transition = 'opacity 400ms ease';
            renderer.domElement.style.opacity = '0';
            return;
          }
        }
      }
      if (now - last < 1000 / 45) return; // cap ~45 fps
      last = now;
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      points.rotation.y += dt * 0.02;
      points.rotation.x = Math.sin(t * 0.05) * 0.05;
      for (const c of cards) {
        c.mesh.position.y += c.speed * dt;
        c.mesh.position.x += Math.sin(t * 0.4 + c.phase) * c.sway * dt;
        c.mesh.rotation.y += c.spin * dt;
        if (c.mesh.position.y > 9) {
          c.mesh.position.y = -9;
          c.mesh.position.x = (Math.random() - 0.5) * 12;
        }
      }
      camera.position.x += (target.x * 0.8 - camera.position.x) * 0.04;
      camera.position.y += (-target.y * 0.5 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, -3);
      renderer.render(scene, camera);
    };
    const start = () => {
      if (!raf) {
        clock.getDelta();
        raf = requestAnimationFrame(tick);
      }
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    start();

    return () => {
      stop();
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
      pGeo.dispose();
      pMat.dispose();
      cardGeo.dispose();
      for (const t of textures) t.dispose();
      for (const m of materials) m.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="pointer-events-none absolute inset-0" data-testid="login-scene" aria-hidden />;
}
