// Blu card holder — three.js scene.
//
// Structure:
//   root            floats and follows the pointer (parallax)
//   └─ holder       the pose of the whole object (tilt, spin, position)
//      ├─ back plate, spine, side straps
//      ├─ frontHinge → front plate (swings open around its bottom edge)
//      ├─ cards[]    each: pivot (tilt at the hinge) → fan (rise + rotate) → mesh
//      └─ tokens[]   two glass shapes that fly out when the holder opens
//
// One number drives everything: `progress` goes 0 (closed) → 1 (open).
// Each part reads its own slice of that number, so open and close are the
// same animation played forwards or backwards.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  CARDS,
  CARD_SHEET,
  loadCardFronts,
  cardBackTexture,
  holderLogoTexture,
  elasticTexture,
  grainTexture,
  backgroundTexture,
} from './textures.js';

// ---------- sizes (1 unit ≈ 1 cm) ----------
const CARD = { w: 5.4 / CARD_SHEET.aspect, h: 5.4, t: 0.14, r: 0.42, rim: 0.1 }; // landscape: the card lies on its side, as in a wallet // rim = width of the light glass border
const HOLDER = { w: 10.0, h: 7.6, t: 0.22, r: 0.55, gap: 0.8 };
// Open pose, measured from the reference frame (angles in radians, from vertical).
const FRONT_ANGLE = 0.55; // front panel leans toward the viewer (31°)
const BACK_ANGLE = 0.98; // back panel leans away (56°)
const OPEN_YAW = -0.6; // whole wallet turned 34° so its face points left
const CAMERA_PITCH = 0.03; // camera is almost level, so top edges stay horizontal
// Each card when open: x = sideways, y = height of its bottom edge above the hinge,
// z = depth (minus = toward the back panel), tilt = lean (plus = toward the viewer).
// Order: back card → front card.
const CARD_OPEN = [
  { x: 0.72, y: 2.0, z: -3.4, tilt: -0.26, roll: 0 },
  { x: 0.72, y: 4.5, z: -1.05, tilt: -0.23, roll: 0 },
  { x: 0.7, y: 6.2, z: 1.0, tilt: 0.16, roll: 0 },
];
const DURATION = 1.9; // seconds for a full open

// ---------- helpers ----------
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const slice = (p, from, to) => clamp01((p - from) / (to - from));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// Stretch a texture exactly once across a flat w × h shape.
function fitUV(geometry, w, h) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  }
  uv.needsUpdate = true;
  return geometry;
}

// ---------- renderer, scene, camera ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(12, 1, 10, 400) // long lens: almost no perspective distortion, like the reference;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

async function init() {
  const cardFront = await loadCardFronts();

  scene.background = backgroundTexture();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;

  // Lights: one soft key light with shadows, one cool rim light.
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(-8, 16, 18);
  key.shadow.camera.far = 80;
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -14, right: 14, top: 20, bottom: -14, near: 1, far: 60 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xcfe0ff, 1.4);
  rim.position.set(10, 6, -12);
  scene.add(rim);

  const root = new THREE.Group();
  const holder = new THREE.Group();
  holder.rotation.order = 'YXZ'; // turn left/right first, so tilting back never skews the edges
  root.add(holder);
  scene.add(root);

  // ---------- holder ----------
  const grain = grainTexture();
  // Smooth matte white felt. Two shades: body and a touch darker raised patch.
  const felt = (color) =>
    new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.92,
      metalness: 0,
      sheen: 0.35,
      sheenRoughness: 0.7,
      sheenColor: new THREE.Color(0x8a8a8a),
      bumpMap: grain,
      bumpScale: 0.7,
    });
  const fabric = felt(0xf0f0f0);
  // The band and the straps are one piece of elastic, so they share the same weave.
  const elastic = (repeat) => {
    const weave = elasticTexture(repeat);
    return new THREE.MeshPhysicalMaterial({
      map: weave,
      bumpMap: weave,
      bumpScale: 1.6,
      roughness: 0.88,
      metalness: 0,
      sheen: 0.3,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color(0x8a8a8a),
    });
  };
  const bandMaterial = elastic(26);
  const strapMaterial = elastic(18);

  const plateGeometry = new THREE.ExtrudeGeometry(roundedRectShape(HOLDER.w, HOLDER.h, HOLDER.r), {
    depth: HOLDER.t - 0.1,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 4,
    curveSegments: 12,
  });
  plateGeometry.translate(0, 0, -(HOLDER.t - 0.1) / 2);

  const hingeY = -HOLDER.h / 2;
  const plateZ = HOLDER.gap / 2 + HOLDER.t / 2;

  const backHinge = new THREE.Group();
  backHinge.position.set(0, hingeY, -plateZ);
  const back = new THREE.Mesh(plateGeometry, fabric);
  back.position.y = HOLDER.h / 2;
  backHinge.add(back);
  holder.add(backHinge);

  const frontHinge = new THREE.Group();
  frontHinge.position.set(0, hingeY, plateZ);
  const front = new THREE.Mesh(plateGeometry, fabric);
  front.position.y = HOLDER.h / 2;
  frontHinge.add(front);
  holder.add(frontHinge);

  // Front panel details: an elastic band near the top, a raised patch below it,
  // and the logo printed on the patch.
  const BAND = { at: HOLDER.h * 0.8, h: HOLDER.h * 0.15 }; // measured up from the hinge
  const band = new THREE.Mesh(new THREE.BoxGeometry(HOLDER.w + 0.03, BAND.h, HOLDER.t + 0.05), bandMaterial);
  band.position.y = BAND.at;
  frontHinge.add(band);

  const PATCH = { w: HOLDER.w * 0.93, h: HOLDER.h * 0.62, r: 0.38 };
  const patchGeometry = new THREE.ExtrudeGeometry(roundedRectShape(PATCH.w, PATCH.h, PATCH.r), {
    depth: 0.02,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 3,
    curveSegments: 10,
  });
  const patchMaterial = felt(0xe2e2e2);
  const patch = new THREE.Mesh(patchGeometry, patchMaterial);
  patch.position.set(0, HOLDER.h * 0.05 + PATCH.h / 2, HOLDER.t / 2);
  frontHinge.add(patch);

  const decal = new THREE.Mesh(
    fitUV(new THREE.ShapeGeometry(roundedRectShape(PATCH.w, PATCH.h, PATCH.r), 10), PATCH.w, PATCH.h),
    new THREE.MeshPhysicalMaterial({
      map: holderLogoTexture(PATCH.w / PATCH.h),
      transparent: true,
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
  );
  decal.position.set(0, patch.position.y, HOLDER.t / 2 + 0.056);
  frontHinge.add(decal);

  // Rounded spine joining the two panels at the bottom.
  const spine = new THREE.Mesh(
    new THREE.CylinderGeometry(plateZ + HOLDER.t / 2, plateZ + HOLDER.t / 2, HOLDER.w - HOLDER.r * 1.2, 32),
    fabric
  );
  spine.rotation.z = Math.PI / 2;
  spine.position.y = hingeY + 0.1;
  holder.add(spine);

  // Two elastic straps that stretch between the panels as the holder opens.
  // They sit at the same height as the band, so the band looks like it wraps around.
  const STRAP_AT = BAND.at;
  const STRAP_BACK = HOLDER.h * 0.88; // where the strap meets the back panel
  // Each strap is a flat ribbon with four corners. Two corners ride on the front
  // panel and two on the back panel, so its ends always follow the panels exactly
  // and nothing sticks out.
  strapMaterial.side = THREE.DoubleSide;
  const straps = [-1, 1].map((side) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([side, 0, 0, side, 0, 0, side, 0, 0, side, 0, 0]), 3)
    );
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), 2));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    const m = new THREE.Mesh(geometry, strapMaterial);
    m.position.x = side * (HOLDER.w / 2 + 0.02);
    m.frustumCulled = false;
    holder.add(m);
    return m;
  });

  // ---------- cards ----------
  // The printed face is slightly smaller than the card body, so the body shows
  // around it as a bright glass border.
  const FACE = { w: CARD.w - CARD.rim * 2, h: CARD.h - CARD.rim * 2 };
  const faceGeometry = fitUV(
    new THREE.ShapeGeometry(roundedRectShape(FACE.w, FACE.h, CARD.r - CARD.rim), 12),
    FACE.w,
    FACE.h
  );
  // The artwork is portrait. Turn it a quarter turn so it fills the sideways card:
  // the card's top edge points left, and the blu Junior logo sits on the right.
  {
    const uv = faceGeometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), 1 - uv.getX(i));
  }
  // Real glass: light passes through and bends (transmission + ior), and the
  // rounded edge catches highlights from the room.
  const rimMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transmission: 0.92,
    thickness: 0.6,
    ior: 1.5,
    roughness: 0.03,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    attenuationColor: new THREE.Color(0xdcecff),
    attenuationDistance: 1.2,
    envMapIntensity: 1.8,
    specularIntensity: 1,
  });
  const BEVEL = 0.04; // rounded glass edge
  const edgeGeometry = new THREE.ExtrudeGeometry(
    roundedRectShape(CARD.w - BEVEL * 2, CARD.h - BEVEL * 2, CARD.r - BEVEL),
    {
      depth: CARD.t - BEVEL * 2,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: BEVEL,
      bevelSegments: 5,
      curveSegments: 16,
    }
  );
  edgeGeometry.translate(0, 0, -(CARD.t - BEVEL * 2) / 2);

  const n = CARDS.length;
  const cards = CARDS.map((card, i) => {
    const k = i / (n - 1); // 0 = back card, 1 = front card
    // Printed plastic: not metallic, with a thin glossy coat.
    const surface = { metalness: 0, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.25 };

    const mesh = new THREE.Group();
    const body = new THREE.Mesh(edgeGeometry, rimMaterial);
    const faceFront = new THREE.Mesh(
      faceGeometry,
      new THREE.MeshPhysicalMaterial({ map: cardFront(card.slot), ...surface })
    );
    faceFront.position.z = CARD.t / 2 + 0.002;
    const faceBack = new THREE.Mesh(
      faceGeometry,
      new THREE.MeshPhysicalMaterial({ map: cardBackTexture(card.back), ...surface })
    );
    faceBack.rotation.y = Math.PI;
    faceBack.position.z = -CARD.t / 2 - 0.002;
    mesh.add(body, faceFront, faceBack);
    mesh.position.y = CARD.h / 2;

    // pivot = the card's bottom edge (moves + leans); fan = roll within the card's own plane.
    const fan = new THREE.Group();
    fan.add(mesh);
    const pivot = new THREE.Group();
    pivot.add(fan);
    holder.add(pivot);

    const o = CARD_OPEN[i];
    return {
      pivot,
      fan,
      k,
      closed: new THREE.Vector3(0, hingeY + 0.35, lerp(-0.26, 0.26, k)),
      open: new THREE.Vector3(o.x, hingeY + o.y, o.z),
      tilt: o.tilt,
      roll: o.roll,
    };
  });

  // ---------- glass tokens ----------
  const glass = (color) =>
    new THREE.MeshPhysicalMaterial({
      color,
      transmission: 1,
      thickness: 1.4,
      roughness: 0.08,
      ior: 1.45,
      attenuationColor: new THREE.Color(color),
      attenuationDistance: 7,
      clearcoat: 1,
    });

  const coin = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.42, 64), glass(0x9cc4ff));
  coin.rotation.x = Math.PI / 2;

  const heartShape = new THREE.Shape();
  heartShape.moveTo(0, -1);
  heartShape.bezierCurveTo(-0.5, -0.55, -1.25, -0.05, -1.25, 0.5);
  heartShape.bezierCurveTo(-1.25, 1.05, -0.45, 1.3, 0, 0.72);
  heartShape.bezierCurveTo(0.45, 1.3, 1.25, 1.05, 1.25, 0.5);
  heartShape.bezierCurveTo(1.25, -0.05, 0.5, -0.55, 0, -1);
  const heartGeometry = new THREE.ExtrudeGeometry(heartShape, {
    depth: 0.3,
    bevelEnabled: true,
    bevelThickness: 0.16,
    bevelSize: 0.16,
    bevelSegments: 8,
    curveSegments: 24,
  });
  heartGeometry.center();
  const heart = new THREE.Mesh(heartGeometry, glass(0xffa3b3));

  const tokens = [
    { mesh: coin, to: new THREE.Vector3(-3.6, hingeY + 14.2, 0), spin: 0.9, rest: new THREE.Euler(0.25, -0.2, 0.1) },
    { mesh: heart, to: new THREE.Vector3(5.9, hingeY + 13.0, 0.5), spin: -0.7, rest: new THREE.Euler(-0.25, 0.45, -0.2) },
  ].map((t) => {
    const wrap = new THREE.Group();
    wrap.add(t.mesh);
    holder.add(wrap);
    return { ...t, wrap };
  });

  holder.traverse((o) => {
    if (o.isMesh && !o.material.transmission) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  decal.castShadow = false;

  // ---------- state + interaction ----------
  let isOpen = false;
  let progress = 0;
  const pointer = new THREE.Vector2();
  const pointerSmooth = new THREE.Vector2();
  let hover = 0;
  let hovering = false;

  function toggle() {
    isOpen = !isOpen;
    canvas.setAttribute('aria-pressed', String(isOpen));
  }
  // Keyboard users: focus the scene and press Enter or Space.
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });

  const raycaster = new THREE.Raycaster();
  const hits = (event) => {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - r.left) / r.width) * 2 - 1,
      -((event.clientY - r.top) / r.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObject(holder, true).length > 0;
  };
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
    hovering = hits(e);
    canvas.style.cursor = hovering ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerleave', () => {
    pointer.set(0, 0);
    hovering = false;
  });
  canvas.addEventListener('click', (e) => {
    if (hits(e)) toggle();
  });

  let needsRender = true;
  function resize() {
    needsRender = true;
    // The canvas fills the window above the footer bar (sized in CSS).
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Pull the camera back on narrow screens so the open fan still fits.
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 2;
    const distance = Math.max(22 / tan, 20 / camera.aspect / tan);
    const target = new THREE.Vector3(0, 1.2, 0);
    camera.position.set(0, target.y + Math.sin(CAMERA_PITCH) * distance, Math.cos(CAMERA_PITCH) * distance);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- frame loop ----------
  const clock = new THREE.Clock();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.25); // real elapsed time, so a slow frame rate never slows the animation

    progress = clamp01(progress + (isOpen ? dt : -dt) / (reducedMotion ? 0.6 : DURATION));
    const p = progress;

    // Whole object: spin once, then settle into the open pose.
    const pose = easeInOut(slice(p, 0, 0.6));
    const spin = reducedMotion ? 0 : easeInOut(slice(p, 0, 0.55)) * Math.PI * 2;
    holder.rotation.set(lerp(0.05, 0, pose), lerp(0.5, OPEN_YAW, pose) + spin, lerp(0.1, 0, pose));
    holder.position.set(lerp(0, -0.9, pose), lerp(1.2, -2.2, pose), 0);
    const hoverTarget = hovering && !isOpen ? 1 : 0;
    hover = Math.abs(hover - hoverTarget) < 0.001 ? hoverTarget : lerp(hover, hoverTarget, 0.12);
    holder.scale.setScalar(lerp(1.2, 1, pose) * (1 + hover * 0.04));

    // Both panels swing apart around the bottom hinge.
    const openness = easeOutBack(slice(p, 0.3, 0.7));
    const fa = FRONT_ANGLE * openness;
    const ba = BACK_ANGLE * openness;
    frontHinge.rotation.x = fa;
    backHinge.rotation.x = -ba;

    // Straps: a point at distance d up a panel sits at (y, z) below.
    const onFront = (d) => [hingeY + d * Math.cos(fa), plateZ + d * Math.sin(fa)];
    const onBack = (d) => [hingeY + d * Math.cos(ba), -plateZ - d * Math.sin(ba)];
    // The strap leaves each panel at a slant. A slanted cut is longer than the
    // strap is wide, so each end is cut at BAND.h / sin(angle): that keeps the
    // strap exactly as wide as the band along its whole length.
    const [fy, fz] = onFront(STRAP_AT);
    const [by, bz] = onBack(STRAP_BACK);
    const len = Math.hypot(by - fy, bz - fz) || 1;
    const dy = (by - fy) / len;
    const dz = (bz - fz) / len;
    const sinFront = Math.abs(dy * Math.sin(fa) - dz * Math.cos(fa));
    const sinBack = Math.abs(dy * -Math.sin(ba) - dz * Math.cos(ba));
    // When closed the strap folds flat against the panels (sin → 0), so the cut is
    // capped there; at that point it is hidden between the panels anyway.
    const halfFront = BAND.h / 2 / Math.max(sinFront, 0.35);
    const halfBack = BAND.h / 2 / Math.max(sinBack, 0.35);
    // Never let a cut run past the panel's top edge (it poked out as a sliver).
    const top = HOLDER.h - HOLDER.r * 0.5;
    const within = (d) => Math.min(d, top);
    const corners = [
      onFront(STRAP_AT - halfFront),
      onFront(within(STRAP_AT + halfFront)),
      onBack(STRAP_BACK - halfBack),
      onBack(within(STRAP_BACK + halfBack)),
    ];
    for (const s of straps) {
      const pos = s.geometry.attributes.position;
      corners.forEach(([y, z], n) => pos.setXYZ(n, 0, y, z));
      pos.needsUpdate = true;
    }

    // Cards travel from inside the wallet to their open spot, back card first.
    for (const c of cards) {
      const start = 0.4 + c.k * 0.14;
      const raw = slice(p, start, start + 0.4);
      c.pivot.position.lerpVectors(c.closed, c.open, easeOutBack(raw));
      c.pivot.rotation.x = c.tilt * easeOut(raw);
      c.fan.rotation.z = c.roll * easeOut(raw);
    }

    // Glass tokens fly up out of the holder.
    for (const k of tokens) {
      const out = easeOutBack(slice(p, 0.6, 1));
      k.wrap.position.lerpVectors(new THREE.Vector3(0, 0, 0), k.to, out);
      k.wrap.scale.setScalar(Math.max(0.0001, out));
      // Tokens turn only while they travel, then rest at a fixed angle.
      k.wrap.rotation.set(k.rest.x, k.rest.y + (1 - out) * k.spin * 4, k.rest.z);
    }

    // Pointer parallax: the object leans toward the cursor. Nothing moves on its own.
    if (pointerSmooth.distanceTo(pointer) < 0.0005) pointerSmooth.copy(pointer);
    else pointerSmooth.lerp(pointer, 0.06);
    root.rotation.y = pointerSmooth.x * 0.22;
    root.rotation.x = pointerSmooth.y * 0.14;

    // Render only when something changed: an idle page costs no GPU work
    // (the glass cards and soft shadows are the expensive part of a frame).
    const state = `${progress}|${hover}|${pointerSmooth.x}|${pointerSmooth.y}`;
    if (state !== lastState || needsRender) {
      renderer.render(scene, camera);
      lastState = state;
      needsRender = false;
    }
    requestAnimationFrame(frame);
  }
  let lastState = '';
  frame();

  // Small handle for debugging from the console.
  window.__blu = { toggle, set: (v) => ((isOpen = v > 0.5), (progress = v)) };
}

init();

// Footer: live GitHub star count (the button reads "Star" until this loads).
fetch('https://api.github.com/repos/HamzehGhoreyshi/blue-bank-cards-animation')
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((repo) => {
    document.querySelector('.star-count').textContent = `Star · ${repo.stargazers_count}`;
  })
  .catch(() => {});
