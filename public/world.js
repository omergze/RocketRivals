/* Rocket Rivals — static stadium: floor, glass walls, goals, stands + crowd, floodlights, boost pads. */
(() => {
'use strict';
const G = window.G; if (!G) return;
const { SIDE, END, GOAL_W, GOAL_H, GOAL_DEPTH, CEIL, CHAMFER, PADS } = window.RR;
const { Builder, PRIM, M4, gl } = G;
const t = new Float32Array(16);
const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const C = {
  blue: hex('#2a9dff'), blueLite: hex('#8fdcff'), orange: hex('#ff7a1c'), orangeLite: hex('#ffc27a'),
  steel: hex('#2a3446'), dark: hex('#0c111b'), darker: hex('#070a12'), cyan: hex('#35e0ff'), white: hex('#eef8ff'),
  concrete: hex('#1b2230'), rail: hex('#3a4a63'), gold: hex('#ffd36a'), seat: hex('#141a28')
};
G.COLORS = C;
const box = (b, x, y, z, sx, sy, sz, c, em = 0, spec = 0.25, yaw = 0, anim = 0) => { M4.compose(t, x, y, z, yaw, 0, 0, sx, sy, sz); b.add(PRIM.box, t, c, em, spec, anim); };
const cyl = (b, x, y, z, r, h, c, em = 0, spec = 0.4, pitch = 0, roll = 0, yaw = 0, prim = PRIM.cyl) => { M4.compose(t, x, y, z, yaw, pitch, roll, r, h, r); b.add(prim, t, c, em, spec); };
const seg = (b, x1, z1, x2, z2, y, th, h, c, em = 0, spec = 0.25) => {  // box along the line (x1,z1)-(x2,z2)
  const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
  box(b, (x1 + x2) / 2, y, (z1 + z2) / 2, th, h, len, c, em, spec, Math.atan2(dx, dz));
};
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// arena outline (octagon with 45° corners), counter-clockwise starting at +x side
const S = SIDE, E = END, K = CHAMFER;
const OUT = [[S, -(E - K)], [S, E - K], [S - K, E], [-(S - K), E], [-S, E - K], [-S, -(E - K)], [-(S - K), -E], [S - K, -E]];
G.ARENA_OUTLINE = OUT;
const teamColor = z => (z > 0 ? C.blue : C.orange);

function polyPrim(y, flip) {
  const p = [0, y, 0], n = [0, 1, 0], i = [];
  for (const [x, z] of OUT) { p.push(x, y, z); n.push(0, 1, 0); }
  for (let k = 0; k < OUT.length; k++) { const a = 1 + k, b = 1 + (k + 1) % OUT.length; if (flip) i.push(0, a, b); else i.push(0, b, a); }
  return { p, n, i };
}
function ringPrim(seg_, rIn, rOut) {
  const p = [], n = [], i = [];
  for (let k = 0; k <= seg_; k++) { const a = k / seg_ * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); p.push(c * rIn, 0, s * rIn, c * rOut, 0, s * rOut); n.push(0, 1, 0, 0, 1, 0); if (k < seg_) { const q = k * 2; i.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); } }
  return { p, n, i };
}

const W = { solid: [], floor: null, ceiling: null, glass: [], nets: [], banners: [], pads: [], towers: [], lights: [] };

function build() {
  const b = new Builder();
  // ---- ground outside + pit under the arena
  box(b, 0, -0.6, 0, 420, 1, 420, C.darker, 0, 0.05);
  box(b, 0, -0.3, 0, S * 2 + 8, 0.5, E * 2 + 8, C.dark, 0, 0.1);

  // ---- floor markings (emissive, flat)
  const line = (x1, z1, x2, z2, c, em = 1.2, th = 0.28) => seg(b, x1, z1, x2, z2, 0.03, th, 0.04, c, em, 0);
  for (let k = 0; k < OUT.length; k++) {   // boundary
    const a = OUT[k], c = OUT[(k + 1) % OUT.length];
    const zm = (a[1] + c[1]) / 2;
    if (Math.abs(a[1]) === E && Math.abs(c[1]) === E) continue;   // end lines are drawn per goal below
    line(a[0], a[1], c[0], c[1], zm > 0 ? C.blueLite : (zm < 0 ? C.orangeLite : C.cyan), 1.3, 0.35);
  }
  for (const sgn of [-1, 1]) {      // end lines (two halves) + goal box + goal glow strip
    const tc = sgn > 0 ? C.blue : C.orange;
    line(GOAL_W / 2, sgn * E, S - K, sgn * E, tc, 1.8, 0.4); line(-GOAL_W / 2, sgn * E, -(S - K), sgn * E, tc, 1.8, 0.4);
    const bw = GOAL_W / 2 + 6, bd = 13;
    line(-bw, sgn * (E - bd), bw, sgn * (E - bd), tc, 0.9, 0.22);
    line(-bw, sgn * (E - bd), -bw, sgn * E, tc, 0.9, 0.22); line(bw, sgn * (E - bd), bw, sgn * E, tc, 0.9, 0.22);
    box(b, 0, 0.025, sgn * (E - 1.5), GOAL_W - 0.6, 0.03, 3, tc, 0.35, 0);
  }
  line(-S, 0, S, 0, C.cyan, 0.9, 0.3);
  M4.compose(t, 0, 0.03, 0, 0, 0, 0, 1, 1, 1); b.add(ringPrim(64, 8.7, 9.1), t, C.cyan, 1.0, 0);
  M4.compose(t, 0, 0.035, 0, 0, 0, 0, 1, 1, 1); b.add(ringPrim(32, 0, 0.9), t, C.white, 1.0, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {   // corner arcs on the chamfers (small neon dots)
    cyl(b, sx * (S - 3.2), 0.03, sz * (E - 3.2), 0.5, 0.05, sz > 0 ? C.blueLite : C.orangeLite, 1.0, 0, 0, 0, 0, PRIM.cylLo);
  }

  // ---- boost pad bases (static); cores are drawn dynamically
  for (const p of PADS) {
    const big = p.type === 'large';
    cyl(b, p.x, 0.025, p.z, big ? 2.1 : 1.15, 0.06, C.steel, 0.1, 0.5);
    M4.compose(t, p.x, 0.065, p.z, 0, 0, 0, 1, 1, 1); b.add(ringPrim(big ? 28 : 18, big ? 1.95 : 1.05, big ? 2.15 : 1.2), t, big ? C.gold : C.orangeLite, big ? 1.3 : 0.8, 0);
  }

  // ---- wall bases, pillars, neon rails, frame
  const wallSegs = [];
  for (let k = 0; k < OUT.length; k++) {
    const a = OUT[k], c = OUT[(k + 1) % OUT.length];
    if (Math.abs(a[1]) === E && Math.abs(c[1]) === E) {   // end wall: two pieces beside the goal mouth
      const sgn = Math.sign(a[1]); const xs = Math.sign(a[0] + c[0]);
      wallSegs.push([xs * GOAL_W / 2, sgn * E, xs * (S - K), sgn * E]);
    } else wallSegs.push([a[0], a[1], c[0], c[1]]);
  }
  W.wallSegs = wallSegs;
  for (const [x1, z1, x2, z2] of wallSegs) {
    const zm = (z1 + z2) / 2, tc = zm > 0.5 ? C.blue : (zm < -0.5 ? C.orange : C.cyan);
    const nx = -(z2 - z1), nz = (x2 - x1), nl = Math.hypot(nx, nz); const ox = nx / nl, oz = nz / nl; // normal (sign fixed below)
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2; const sgn = (mx * ox + mz * oz) >= 0 ? 1 : -1;  // outward
    const ux = ox * sgn, uz = oz * sgn;
    const off = (d) => [ux * d, uz * d];
    seg(b, x1 + off(0.45)[0], z1 + off(0.45)[1], x2 + off(0.45)[0], z2 + off(0.45)[1], 0.75, 0.9, 1.5, C.steel, 0, 0.5);      // solid base
    seg(b, x1 + off(0.0)[0], z1 + off(0.0)[1], x2 + off(0.0)[0], z2 + off(0.0)[1], 1.55, 0.25, 0.12, tc, 2.0, 0);            // neon at the glass foot
    seg(b, x1 + off(0.35)[0], z1 + off(0.35)[1], x2 + off(0.35)[0], z2 + off(0.35)[1], CEIL + 0.3, 0.7, 0.6, C.steel, 0, 0.5); // top beam
    seg(b, x1, z1, x2, z2, CEIL - 0.15, 0.22, 0.14, tc, 2.2, 0);                                                              // top neon
    seg(b, x1 + off(0.9)[0], z1 + off(0.9)[1], x2 + off(0.9)[0], z2 + off(0.9)[1], CEIL * 0.55, 0.12, 0.16, C.cyan, 0.8, 0); // mid accent
    // pillars every ~7 units
    const len = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.round(len / 7));
    for (let q = 0; q <= n; q++) { const f = q / n; box(b, x1 + (x2 - x1) * f + ux * 0.3, CEIL / 2, z1 + (z2 - z1) * f + uz * 0.3, 0.55, CEIL + 0.6, 0.55, C.steel, 0, 0.4); }
    // glass quad data
    W.glass.push({ x: mx, z: mz, len, yaw: Math.atan2(-(z2 - z1), x2 - x1) });
  }

  // ---- goals (frame, backboard, housing)
  for (const sgn of [-1, 1]) {
    const tc = sgn > 0 ? C.blue : C.orange, tl = sgn > 0 ? C.blueLite : C.orangeLite, z0 = sgn * E, z1 = sgn * (E + GOAL_DEPTH);
    for (const sx of [-1, 1]) {
      cyl(b, sx * GOAL_W / 2, GOAL_H / 2, z0, 0.36, GOAL_H, tc, 1.6, 0.6);                  // front posts
      cyl(b, sx * GOAL_W / 2, GOAL_H / 2, z1, 0.3, GOAL_H, C.steel, 0.2, 0.5);               // back posts
      cyl(b, sx * GOAL_W / 2, GOAL_H, (z0 + z1) / 2, 0.22, GOAL_DEPTH, tl, 1.4, 0.5, Math.PI / 2);   // roof side bars
      box(b, sx * (GOAL_W / 2 + 0.9), 3.2, (z0 + z1) / 2, 1.6, 6.4, GOAL_DEPTH + 1.2, C.concrete, 0, 0.2);   // housing beside the goal
      box(b, sx * (GOAL_W / 2 + 0.2), 0.3, (z0 + z1) / 2, 0.15, 0.2, GOAL_DEPTH, tc, 1.5, 0);
    }
    cyl(b, 0, GOAL_H, z0, 0.3, GOAL_W, tc, 1.8, 0.6, 0, Math.PI / 2);                         // crossbar
    cyl(b, 0, GOAL_H, z1, 0.22, GOAL_W, C.steel, 0.2, 0.5, 0, Math.PI / 2);
    box(b, 0, GOAL_H + 1.8, z1 + sgn * 0.6, GOAL_W + 4.4, 7.4, 1.2, C.concrete, 0, 0.2);          // backboard
    box(b, 0, 0.12, (z0 + z1) / 2, GOAL_W, 0.24, GOAL_DEPTH, C.dark, 0, 0.6);                    // pocket floor
    box(b, 0, 0.26, (z0 + z1) / 2, GOAL_W - 1.2, 0.04, GOAL_DEPTH - 1, tc, 0.55, 0);
    box(b, 0, GOAL_H + 5.6, z1 + sgn * 1.4, GOAL_W + 6, 0.5, 1.8, C.steel, 0, 0.5);
    box(b, 0, GOAL_H + 5.9, z1 + sgn * 1.4, GOAL_W + 5, 0.14, 1.9, tl, 1.8, 0);
    W.lights.push({ x: 0, y: GOAL_H - 0.5, z: sgn * (E + 1.5), range: 46, r: tc[0] * 1.5, g: tc[1] * 1.5, b: tc[2] * 1.5, goal: sgn });
  }

  // ---- stands + crowd
  const crowdCols = [C.blue, C.orange, C.white, hex('#6a7da0'), hex('#1b2336'), hex('#ffd36a'), hex('#c9d6ee'), hex('#2a9dff'), hex('#ff7a1c')];
  const crowdDark = [hex('#1a2234'), hex('#232c42'), hex('#2c3650'), hex('#182036'), hex('#34405c')], skin = [hex('#c58c6a'), hex('#8d5a3c'), hex('#e0b08c'), hex('#5a3a28'), hex('#f0c8a0')];
  const tiers = 9, rise = 1.25, run = 1.7;
  const stand = (cx, cz, len, dirx, dirz, face) => {   // dir = outward direction of the stand; face = yaw so seats look at the pitch
    const tx = -dirz, tz = dirx;  // tangent along the stand
    for (let r = 0; r < tiers; r++) {
      const d = 4.2 + r * run, y = 1.2 + r * rise;
      const px = cx + dirx * d, pz = cz + dirz * d;
      box(b, px, y - 0.2, pz, Math.abs(dirx) ? run + 0.1 : len, 0.5, Math.abs(dirx) ? len : run + 0.1, C.seat, 0, 0.1);
      box(b, px - dirx * run * 0.5, y + 0.12, pz - dirz * run * 0.5, Math.abs(dirx) ? 0.1 : len, 0.05, Math.abs(dirx) ? len : 0.1, r % 2 ? C.cyan : tc2(cz), 0.9, 0);
      const step = 1.15, n = Math.floor(len / step);
      for (let q = 0; q < n; q++) {
        if (rnd() < 0.1) continue;
        const sOff = -len / 2 + (q + 0.5) * step + (rnd() - 0.5) * 0.2;
        const bright = rnd() < 0.3, col = (bright ? crowdCols[(rnd() * crowdCols.length) | 0] : crowdDark[(rnd() * crowdDark.length) | 0]);
        const hgt = 0.5 + rnd() * 0.18, x = px + tx * sOff + dirx * 0.2, z = pz + tz * sOff + dirz * 0.2, ya = face + (rnd() - 0.5) * 0.5, an = rnd() < 0.5 ? 1 : 0;
        box(b, x, y + 0.2 + hgt / 2, z, 0.46, hgt, 0.34, col, bright ? 0.25 : 0.06, 0.05, ya, 0, 0, an);
        box(b, x, y + 0.2 + hgt + 0.13, z, 0.22, 0.22, 0.22, skin[(rnd() * skin.length) | 0], 0.05, 0.1, ya, 0, 0, an);
      }
    }
    // canopy over the stand
    const d = 4.2 + tiers * run + 1.5;
    box(b, cx + dirx * d, 1.2 + tiers * rise + 3.4, cz + dirz * d, Math.abs(dirx) ? 8 : len + 6, 0.5, Math.abs(dirx) ? len + 6 : 8, C.steel, 0, 0.5);
  };
  function tc2(z) { return z > 0 ? C.blue : (z < 0 ? C.orange : C.cyan); }
  stand(S + 1.2, 0, E * 2 + 4, 1, 0, -Math.PI / 2); stand(-S - 1.2, 0, E * 2 + 4, -1, 0, Math.PI / 2);
  stand(0, E + GOAL_DEPTH + 3.5, S * 2 + 10, 0, 1, Math.PI); stand(0, -E - GOAL_DEPTH - 3.5, S * 2 + 10, 0, -1, 0);

  // ---- floodlight towers
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (S + 14), z = sz * (E + 12), h = 34;
    cyl(b, x, h / 2, z, 0.8, h, C.steel, 0, 0.5);
    cyl(b, x, 1.2, z, 1.5, 2.4, C.dark, 0, 0.3);
    M4.compose(t, x, h + 1.5, z, Math.atan2(-sx, -sz), 0.35, 0, 1, 1, 1);
    const rig = new Float32Array(t);
    // light panel (3x2 emissive lamps) facing the pitch
    for (let ix = -1; ix <= 1; ix++) for (let iy = -1; iy <= 0; iy++) {
      const yaw = Math.atan2(-sx, -sz);
      const ox = Math.cos(yaw) * ix * 2.2, oz = -Math.sin(yaw) * ix * 2.2;
      box(b, x + ox, h + 1.5 + iy * 2.2, z + oz, 2.0, 1.9, 0.6, C.white, 3.2, 0.2, yaw);
    }
    box(b, x, h + 0.3, z, 7.4, 6.4, 0.5, C.dark, 0, 0.2, Math.atan2(-sx, -sz) + 0);
    W.towers.push({ x, y: h + 1.2, z });
    void rig;
  }
  W.lights.push({ x: 20, y: 30, z: 24, range: 150, r: 0.9, g: 0.95, b: 1.1 }, { x: -20, y: 30, z: -24, range: 150, r: 0.9, g: 0.95, b: 1.1 },
    { x: 0, y: 12, z: 0, range: 0, r: 0, g: 0, b: 0, flash: true });   // dynamic flash slot (index 2 after sorting below)
  // light ordering expected by the renderer: 0,1 floods, 2 flash, 3 blue goal, 4 orange goal, 5,6 floods, 7 centre
  const floods = W.lights.filter(l => l.range === 150), flash = W.lights.find(l => l.flash), blueG = W.lights.find(l => l.goal === 1), orangeG = W.lights.find(l => l.goal === -1);
  W.lightList = [floods[0], floods[1], flash, blueG, orangeG,
    { x: 20, y: 30, z: -24, range: 150, r: 0.9, g: 0.95, b: 1.1 }, { x: -20, y: 30, z: 24, range: 150, r: 0.9, g: 0.95, b: 1.1 },
    { x: 0, y: 16, z: 0, range: 90, r: 0.15, g: 0.35, b: 0.5 }];
  G.env.lights = W.lightList; W.flash = flash;

  // ---- jumbotron
  box(b, 0, CEIL + 9.5, 0, 12, 4.6, 12, C.dark, 0, 0.3);
  box(b, 0, CEIL + 12.0, 0, 3, 3, 3, C.steel, 0, 0.4);
  for (const sgn of [-1, 1]) { cyl(b, sgn * 5, CEIL + 14, sgn * 5, 0.15, 6, C.steel); }

  W.solid = b.build();

  // ---- floor / ceiling polygons (own materials)
  const fb = new Builder(); fb.add(polyPrim(0, false), null, [1, 1, 1], 0, 0.7); W.floor = fb.build()[0];
  const cb = new Builder(); cb.add(polyPrim(CEIL, true), null, [1, 1, 1], 0, 0); W.ceiling = cb.build()[0];
  // glass wall quad mesh: one unit quad, scaled per segment
  W.quad = G.primMesh(PRIM.quad, [1, 1, 1], 0, 0);
  // goal nets
  const nb = new Builder();
  for (const sgn of [-1, 1]) {
    const z0 = sgn * E, z1 = sgn * (E + GOAL_DEPTH), zm = (z0 + z1) / 2;
    M4.compose(t, 0, GOAL_H / 2, z1, 0, 0, 0, GOAL_W, GOAL_H, 1); nb.add(PRIM.quad, t, [1, 1, 1], 0, 0);
    for (const sx of [-1, 1]) { M4.compose(t, sx * GOAL_W / 2, GOAL_H / 2, zm, Math.PI / 2, 0, 0, GOAL_DEPTH, GOAL_H, 1); nb.add(PRIM.quad, t, [1, 1, 1], 0, 0); }
    M4.compose(t, 0, GOAL_H, zm, 0, -Math.PI / 2, 0, GOAL_W, GOAL_DEPTH, 1); nb.add(PRIM.quad, t, [1, 1, 1], 0, 0);
  }
  W.nets = nb.build();

  // ---- pad cores + orbs
  W.padCore = { small: G.primMesh(PRIM.cyl, [1, 1, 1], 1, 0.3), large: G.primMesh(PRIM.cyl, [1, 1, 1], 1, 0.3) };
  W.orb = G.primMesh(PRIM.sphere, [1, 1, 1], 1, 0.6);
  W.cone = G.primMesh(PRIM.cone, [1, 1, 1], 1, 0);
  W.sphere = G.primMesh(PRIM.sphere, [1, 1, 1], 0, 0.5);
}

// ---- banner texture
function makeBannerTexture() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1024, 0); grad.addColorStop(0, '#0a1a38'); grad.addColorStop(0.5, '#0b2a4a'); grad.addColorStop(1, '#2a1408');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 128);
  g.font = 'italic 900 56px "Arial Black", Impact, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
  for (let k = 0; k < 2; k++) {
    const x = 256 + k * 512; g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,.18)'; g.strokeText('ROCKET RIVALS', x, 66);
    const tg = g.createLinearGradient(x - 220, 0, x + 220, 0); tg.addColorStop(0, '#53d8ff'); tg.addColorStop(1, '#ffb047'); g.fillStyle = tg; g.fillText('ROCKET RIVALS', x, 66);
  }
  g.fillStyle = '#35e0ff'; g.fillRect(0, 0, 1024, 6); g.fillStyle = '#ff7a1c'; g.fillRect(0, 122, 1024, 6);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  // mipmapped + anisotropic filtering: banners stay sharp up close and stop shimmering at a distance (1024x128 is power-of-two)
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  G.bannerTex = tex;
}

// banners: [x,y,z, w,h, yaw]
const BANNERS = [];
function defineBanners() {
  for (const sgn of [-1, 1]) {
    BANNERS.push([0, GOAL_H + 5.0, sgn * (E + GOAL_DEPTH - 0.1), GOAL_W + 4.2, 2.5, sgn > 0 ? Math.PI : 0]);
    BANNERS.push([sgn * (S + 0.9), 2.9, 0, 2 * E - 2 * K, 1.5, -sgn * Math.PI / 2]);
  }
  for (const [x, z, yaw] of [[0, 6.01, 0], [0, -6.01, Math.PI], [6.01, 0, Math.PI / 2], [-6.01, 0, -Math.PI / 2]]) BANNERS.push([x, CEIL + 9.5, z, 11.5, 4.1, yaw]);
}

W.init = function () {
  makeBannerTexture(); defineBanners(); build();
};

// ---- drawing
const m = new Float32Array(16);
W.drawOpaque = function (time, padState, padFlash) {
  G.lite(1); G.mat(1, 1, 1, 1, 1, 0);
  for (const mesh of W.solid) G.draw(mesh, null);
  G.lite(0); G.mat(1, 1, 1, 1, 1, 2); G.draw(W.floor, null);
  // banners (textured)
  for (const bn of BANNERS) { G.mat(1, 1, 1, 1, 1, 7, Math.max(1, Math.round(bn[3] / (bn[4] * 6))), 0, 0); M4.compose(m, bn[0], bn[1], bn[2], bn[5], 0, 0, bn[3], bn[4], 1); G.draw(W.quad, m); }
  // boost pad cores
  G.mat(1, 1, 1, 1, 1, 0);
  for (const p of PADS) {
    const on = !padState || padState[p.id] !== '0', big = p.type === 'large';
    const age = padFlash ? padFlash[p.id] || 0 : 0;
    if (on) {
      const pulse = 0.85 + 0.15 * Math.sin(time * 4 + p.id);
      G.mat(big ? 1.0 : 1.0, big ? 0.72 : 0.62, big ? 0.15 : 0.1, 1.6 * pulse + age * 3, 1, 0);
      M4.compose(m, p.x, 0.09, p.z, 0, 0, 0, big ? 1.7 : 0.85, 0.08, big ? 1.7 : 0.85); G.draw(W.padCore.small, m);
      if (big) {
        const bob = Math.sin(time * 2.6 + p.id) * 0.18;
        G.mat(1, 0.85, 0.35, 2.0, 1, 0);
        M4.compose(m, p.x, 1.35 + bob, p.z, time * 1.4, 0, 0, 0.65, 0.65, 0.65); G.draw(W.orb, m);
      } else {
        G.mat(1, 0.8, 0.4, 1.8, 1, 0);
        M4.compose(m, p.x, 0.42 + Math.sin(time * 3 + p.id) * 0.07, p.z, time * 2, 0, 0, 0.25, 0.25, 0.25); G.draw(W.orb, m);
      }
    } else {
      G.mat(0.18, 0.2, 0.26, 0.15, 1, 0);
      M4.compose(m, p.x, 0.09, p.z, 0, 0, 0, big ? 1.7 : 0.85, 0.06, big ? 1.7 : 0.85); G.draw(W.padCore.small, m);
    }
  }
};
W.drawTransparent = function (time) {
  gl.disable(gl.CULL_FACE);
  // glass walls
  G.mat(1, 1, 1, 1, 1, 3);
  for (const gq of W.glass) { M4.compose(m, gq.x, 1.5 + (CEIL - 1.5) / 2, gq.z, gq.yaw, 0, 0, gq.len, CEIL - 1.5, 1); G.draw(W.quad, m); }
  // ceiling lattice
  G.mat(1, 1, 1, 1, 1, 4); G.draw(W.ceiling, null);
  // goal nets
  G.mat(1, 1, 1, 1, 1, 5);
  for (const mesh of W.nets) G.draw(mesh, null);
  gl.enable(gl.CULL_FACE);
};
window.World = W;
})();
