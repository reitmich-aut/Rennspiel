// ===== CONSTANTS =====
const CANVAS_W = 800, CANVAS_H = 440;
const CX = CANVAS_W / 2;
const CZ = CANVAS_H / 2;
const BORDER_W = 6;

// Dynamic track state — set by activateTrack()
let TRACK_WIDTH = 76;
let TRACK_PATH  = [];
let TRACK_SEGS  = [];

function buildSegs(path) {
  const segs = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i+1];
    const dx = b.x-a.x, dy = b.y-a.y;
    const len = Math.sqrt(dx*dx+dy*dy);
    if (len > 0) segs.push({ ax:a.x,ay:a.y,bx:b.x,by:b.y,dx,dy,len });
  }
  return segs;
}

// ===== CATMULL-ROM SPLINE =====
function crPt(p0,p1,p2,p3,t) {
  const t2=t*t, t3=t2*t;
  return {
    x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
    y:0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)
  };
}
function buildSpline(ctrl, sps) {
  const n=ctrl.length, pts=[];
  for (let i=0;i<n;i++) {
    const p0=ctrl[(i-1+n)%n],p1=ctrl[i],p2=ctrl[(i+1)%n],p3=ctrl[(i+2)%n];
    for (let s=0;s<sps;s++) pts.push(crPt(p0,p1,p2,p3,s/sps));
  }
  pts.push({...pts[0]});
  return pts;
}

// ===== TRACK DEFINITIONS =====
const TRACKS = {
  easy: {
    label:'Leicht', desc:'Ovale Strecke', width:76, carSpeed:2.8,
    path: buildSpline([
      {x:400,y:28},{x:570,y:38},{x:700,y:95},{x:740,y:200},
      {x:720,y:330},{x:600,y:400},{x:400,y:415},{x:200,y:400},
      {x:80,y:330},{x:60,y:200},{x:100,y:95},{x:230,y:38}
    ], 10),
    obstacles:[], tunnel:null, ramp:null
  },
  medium: {
    label:'Mittel', desc:'Kurven & Hindernisse', width:60, carSpeed:3.0,
    path: buildSpline([
      {x:400,y:42},{x:590,y:42},{x:700,y:100},{x:730,y:210},
      {x:700,y:322},{x:600,y:386},{x:478,y:386},
      {x:442,y:348},{x:400,y:386},{x:358,y:348},{x:310,y:386},
      {x:200,y:386},{x:100,y:322},{x:70,y:210},{x:100,y:100},{x:210,y:42}
    ], 8),
    obstacles:[
      {x:442,y:364},{x:358,y:364},{x:400,y:344}
    ],
    tunnel:null, ramp:null
  },
  hard: {
    label:'Schwer', desc:'Tunnel & Rampen', width:50, carSpeed:3.4,
    path: buildSpline([
      {x:370,y:50},{x:550,y:50},{x:680,y:80},{x:720,y:162},
      {x:700,y:252},{x:620,y:298},{x:518,y:320},{x:418,y:334},
      {x:338,y:308},{x:268,y:354},{x:198,y:392},{x:138,y:392},
      {x:88,y:352},{x:78,y:270},{x:98,y:182},{x:150,y:110},
      {x:240,y:78},{x:312,y:58}
    ], 8),
    obstacles:[
      {x:700,y:218},{x:660,y:268},
      {x:490,y:328},{x:408,y:332},
      {x:128,y:358},{x:130,y:386}
    ],
    tunnel:{ from:48, to:70 },
    ramp:  { from:72, to:80 }
  }
};

// ===== TRACK COLLISION (2D, unchanged) =====
function distToSeg(px, py, seg) {
  const t = Math.max(0, Math.min(1,
    ((px - seg.ax) * seg.dx + (py - seg.ay) * seg.dy) / (seg.len * seg.len)
  ));
  const nx = seg.ax + t * seg.dx - px;
  const ny = seg.ay + t * seg.dy - py;
  return Math.sqrt(nx * nx + ny * ny);
}

function isOnTrack(px, py) {
  for (const seg of TRACK_SEGS) {
    if (distToSeg(px, py, seg) < TRACK_WIDTH / 2) return true;
  }
  return false;
}

// ===== THREE.JS GLOBALS =====
let scene, camera, renderer, letterGroup;

// ===== GAME STATE =====
let car, letters, currentWord, collectedCount, score, lives, gameState, animId;
let keys = {};
let words = [];
let wordsCompleted = 0;
let selectedLevel = 1;
let selectedTrack  = 'easy';
let steeringAngle = 0;
let tick = 0;
let messageTimer = null;
let trackMeshes    = [];   // 3D meshes rebuilt per track
let obstacleObjects = [];  // {x,y,radius} for 2D collision

// ===== DOM REFS (set in init) =====
let domSteering, domEmoji, domWordDisplay, domScore, domLives, domWords, domLevelNum, domSpeedNum, domNeedle, domMessage;

// ===== SCENE INIT =====
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7DA7E8); // Minecraft sky blue
  scene.fog = new THREE.Fog(0x7DA7E8, 300, 800);

  camera = new THREE.PerspectiveCamera(72, CANVAS_W / CANVAS_H, 0.5, 1200);

  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas'), antialias: true });
  renderer.setSize(CANVAS_W, CANVAS_H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));

  const sun = new THREE.DirectionalLight(0xfff8e0, 1.1);
  sun.position.set(80, 150, 60);
  scene.add(sun);

  scene.add(new THREE.HemisphereLight(0x87CEEB, 0x2d5a22, 0.45));

  // Ground (Minecraft grass)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshLambertMaterial({ color: 0x5B8731 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  // Letter group
  letterGroup = new THREE.Group();
  scene.add(letterGroup);

  // Decorative trees (fixed positions)
  addTrees();
  resizeRenderer();
}

// ===== RESPONSIVE RENDERER =====
function resizeRenderer() {
  if (!renderer || !camera) return;
  const wrapper = document.getElementById('canvas-wrapper');
  const w = Math.max(wrapper.clientWidth,  1);
  const h = Math.max(wrapper.clientHeight, 1);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (gameState !== 'playing') renderer.render(scene, camera);
}
window.addEventListener('resize', resizeRenderer);

// ===== HELPER: accumulate quad vertices into array =====
function pushQuad(arr, ax, az, bx, bz, nx, nz, w1, w2, y) {
  // Two triangles forming a flat quad on the XZ plane
  arr.push(
    ax + nx * w1, y, az + nz * w1,
    ax + nx * w2, y, az + nz * w2,
    bx + nx * w1, y, bz + nz * w1,

    ax + nx * w2, y, az + nz * w2,
    bx + nx * w2, y, bz + nz * w2,
    bx + nx * w1, y, bz + nz * w1
  );
}

function makeMeshFromVerts(verts, color, y01) {
  const pos = new Float32Array(verts);
  const nor = new Float32Array(verts.length);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1; // all normals point up
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.FrontSide }));
}

// ===== TRACK BUILDING (merged geometry = 3 draw calls) =====
function buildTrack3D() {
  const aspVerts = [], borVerts = [], dashVerts = [], sfVerts = [];
  const hw = TRACK_WIDTH / 2;

  for (let i = 0; i < TRACK_SEGS.length; i++) {
    const seg = TRACK_SEGS[i];
    const nx = -seg.dy / seg.len;
    const nz =  seg.dx / seg.len;
    const ax = seg.ax - CX, az = seg.ay - CZ;
    const bx = seg.bx - CX, bz = seg.by - CZ;

    // Asphalt (full width)
    pushQuad(aspVerts, ax, az, bx, bz, nx, nz, -hw, hw, 0.01);

    // White border left & right
    pushQuad(borVerts, ax, az, bx, bz, nx, nz,  hw, hw + BORDER_W, 0.015);
    pushQuad(borVerts, ax, az, bx, bz, nx, nz, -(hw + BORDER_W), -hw, 0.015);

    // Dashed centre line (every other segment)
    if (i % 2 === 0) {
      pushQuad(dashVerts, ax, az, bx, bz, nx, nz, -2.5, 2.5, 0.025);
    }

    // Start/finish line (first 2 segments, checkered 4 columns)
    if (i === 0 || i === 1) {
      const colW = TRACK_WIDTH / 4;
      for (let c = 0; c < 4; c++) {
        const even = (c + i) % 2 === 0;
        pushQuad(sfVerts, ax, az, bx, bz, nx, nz,
          -hw + c * colW, -hw + (c + 1) * colW, 0.03);
        // tag colour later by splitting sfVerts into white/black
      }
    }
  }

  const addTM = m => { scene.add(m); trackMeshes.push(m); };
  addTM(makeMeshFromVerts(aspVerts,  0x7B7B7B)); // cobblestone
  addTM(makeMeshFromVerts(borVerts,  0xAAAAAA)); // stone border
  addTM(makeMeshFromVerts(dashVerts, 0xFFFFFF)); // white centre line

  // Start/finish stripe
  if (TRACK_SEGS.length > 0) {
    const seg0 = TRACK_SEGS[0];
    const snx = -seg0.dy / seg0.len, snz = seg0.dx / seg0.len;
    const sax = seg0.ax - CX, saz = seg0.ay - CZ;
    const sbx = seg0.bx - CX, sbz = seg0.by - CZ;
    const hw2 = TRACK_WIDTH / 2;
    const sfW = [], sfB = [];
    const cw = TRACK_WIDTH / 4;
    for (let c = 0; c < 4; c++) {
      const l = -hw2 + c*cw, r = l+cw;
      (c%2===0 ? sfW : sfB).push(
        sax+snx*l,0.035,saz+snz*l, sax+snx*r,0.035,saz+snz*r, sbx+snx*l,0.035,sbz+snz*l,
        sax+snx*r,0.035,saz+snz*r, sbx+snx*r,0.035,sbz+snz*r, sbx+snx*l,0.035,sbz+snz*l
      );
    }
    addTM(makeMeshFromVerts(sfW, 0xffffff));
    addTM(makeMeshFromVerts(sfB, 0x111111));
  }
}

// ===== DECORATIVE TREES (Minecraft cube style) =====
function addTrees() {
  const logMat    = new THREE.MeshLambertMaterial({ color: 0x6B4226 }); // oak log
  const leavesMat = new THREE.MeshLambertMaterial({ color: 0x3D6B24 }); // dark leaves
  const leavesAlt = new THREE.MeshLambertMaterial({ color: 0x4D8030 }); // lighter leaves

  const logGeo    = new THREE.BoxGeometry(5, 14, 5);
  const leavesGeo = new THREE.BoxGeometry(16, 12, 16);
  const topGeo    = new THREE.BoxGeometry(10, 8, 10);

  const positions = [];
  const rings = [{ r: 330, count: 24 }, { r: 375, count: 30 }];
  for (const { r, count } of rings) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      positions.push({ x: r * 1.06 * Math.cos(a), z: r * 0.72 * Math.sin(a) });
    }
  }
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    positions.push({ x: 220 * Math.cos(a), z: 145 * Math.sin(a) });
  }

  for (const { x, z } of positions) {
    const h = 10 + Math.floor(Math.random() * 5) * 2;
    const trunk = new THREE.Mesh(logGeo, logMat);
    trunk.position.set(x, h / 2 - 6, z);
    scene.add(trunk);
    const mat = Math.random() > 0.5 ? leavesMat : leavesAlt;
    const leaves = new THREE.Mesh(leavesGeo, mat);
    leaves.position.set(x, h + 2, z);
    scene.add(leaves);
    const top = new THREE.Mesh(topGeo, leavesMat);
    top.position.set(x, h + 10, z);
    scene.add(top);
  }
}

// ===== TRACK MANAGEMENT =====
function clearTrackMeshes() {
  for (const m of trackMeshes) scene.remove(m);
  trackMeshes = [];
  obstacleObjects = [];
}

function buildObstacles3D(cfg) {
  if (!cfg.obstacles || !cfg.obstacles.length) return;
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x555566 });
  const capMat  = new THREE.MeshLambertMaterial({ color: 0xDD2222 });
  for (const o of cfg.obstacles) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(8, 14, 8), bodyMat);
    body.position.set(o.x - CX, 7, o.y - CZ);
    scene.add(body); trackMeshes.push(body);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(9, 3, 9), capMat);
    cap.position.set(o.x - CX, 15.5, o.y - CZ);
    scene.add(cap); trackMeshes.push(cap);
    obstacleObjects.push({ x: o.x, y: o.y, radius: 11 });
  }
}

function buildTunnel3D(cfg) {
  if (!cfg.tunnel) return;
  const { from, to } = cfg.tunnel;
  const hw      = TRACK_WIDTH / 2 + 4;
  const wallH   = 28, wallT = 5;
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x3A3A3A });
  const ceilMat = new THREE.MeshLambertMaterial({ color: 0x252525 });
  for (let i = from; i <= to && i < TRACK_SEGS.length; i++) {
    const seg = TRACK_SEGS[i];
    const { len, dx, dy } = seg;
    const nx = -dy / len, nz = dx / len;
    const mx = (seg.ax + seg.bx) / 2 - CX;
    const mz = (seg.ay + seg.by) / 2 - CZ;
    const ang = Math.atan2(dx, dy);
    const addW = (ox, oz) => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(len + 1, wallH, wallT), wallMat);
      w.position.set(mx + ox, wallH / 2, mz + oz);
      w.rotation.y = ang;
      scene.add(w); trackMeshes.push(w);
    };
    addW(nx * hw, nz * hw);
    addW(-nx * hw, -nz * hw);
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(len + 1, wallT, hw * 2 + wallT * 2), ceilMat);
    ceil.position.set(mx, wallH + wallT / 2, mz);
    ceil.rotation.y = ang;
    scene.add(ceil); trackMeshes.push(ceil);
  }
}

function buildRamp3D(cfg) {
  if (!cfg.ramp) return;
  const { from, to } = cfg.ramp;
  const total   = Math.max(to - from, 1);
  const rampMat = new THREE.MeshLambertMaterial({ color: 0x8B6233 });
  const railMat = new THREE.MeshLambertMaterial({ color: 0x5C3A1A });
  for (let i = from; i <= to && i < TRACK_SEGS.length; i++) {
    const seg = TRACK_SEGS[i];
    const t   = (i - from) / total;
    const h   = Math.sin(t * Math.PI) * 10;
    const mx  = (seg.ax + seg.bx) / 2 - CX;
    const mz  = (seg.ay + seg.by) / 2 - CZ;
    const ang = Math.atan2(seg.dx, seg.dy);
    const tilt = (t < 0.5 ? 0.22 : -0.22);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(seg.len + 1, 3, TRACK_WIDTH + 4), rampMat);
    ramp.position.set(mx, h, mz);
    ramp.rotation.y = ang;
    ramp.rotation.z = tilt;
    scene.add(ramp); trackMeshes.push(ramp);
    // Guard rails on ramp
    const hw = TRACK_WIDTH / 2 + 3;
    const nx = -seg.dy / seg.len, nz = seg.dx / seg.len;
    for (const side of [1, -1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(seg.len + 1, 6, 3), railMat);
      rail.position.set(mx + side * nx * hw, h + 4, mz + side * nz * hw);
      rail.rotation.y = ang;
      scene.add(rail); trackMeshes.push(rail);
    }
  }
}

function activateTrack(id) {
  const cfg = TRACKS[id] || TRACKS.easy;
  TRACK_WIDTH = cfg.width;
  TRACK_PATH  = cfg.path;
  TRACK_SEGS  = buildSegs(cfg.path);
}

function rebuildTrack3D() {
  clearTrackMeshes();
  buildTrack3D();
  const cfg = TRACKS[selectedTrack];
  buildObstacles3D(cfg);
  buildTunnel3D(cfg);
  buildRamp3D(cfg);
}

// ===== LETTER SPRITES (Minecraft sign style) =====
function drawLetterCanvas(ctx, char, isNext, size) {
  const mainColor   = isNext ? '#F7C948' : '#55FF55';
  const shadowColor = isNext ? '#5C4A00' : '#005500';
  const borderColor = isNext ? '#F7C948' : '#3DB83D';
  const bgColor     = isNext ? 'rgba(50,35,0,0.88)' : 'rgba(0,30,0,0.88)';

  ctx.clearRect(0, 0, size, size);

  // Square background (Minecraft sign)
  const m = 10;
  ctx.fillStyle = bgColor;
  ctx.fillRect(m, m, size - m * 2, size - m * 2);

  // Pixel border (thick outer frame)
  const bw = 8;
  ctx.fillStyle = borderColor;
  ctx.fillRect(m, m, size - m * 2, bw);                   // top
  ctx.fillRect(m, size - m - bw, size - m * 2, bw);        // bottom
  ctx.fillRect(m, m, bw, size - m * 2);                    // left
  ctx.fillRect(size - m - bw, m, bw, size - m * 2);        // right

  // Inner highlight (Minecraft 3D-raised look)
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(m + bw, m + bw, size - m * 2 - bw * 2, 4);
  ctx.fillRect(m + bw, m + bw, 4, size - m * 2 - bw * 2);

  // Letter shadow (Minecraft text has drop shadow)
  const fontSize = Math.floor(size * 0.52);
  ctx.font = `bold ${fontSize}px 'Courier New', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const sx = Math.ceil(fontSize * 0.06);
  ctx.fillStyle = shadowColor;
  ctx.fillText(char, size / 2 + sx, size / 2 + sx);

  // Letter main
  ctx.fillStyle = mainColor;
  ctx.fillText(char, size / 2, size / 2);
}

function createLetterSprite(char, isNext) {
  const size = 256;
  const offscreen = document.createElement('canvas');
  offscreen.width = offscreen.height = size;
  const ctx = offscreen.getContext('2d');
  drawLetterCanvas(ctx, char, isNext, size);

  const texture = new THREE.CanvasTexture(offscreen);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(30, 30, 1);
  return { sprite, texture, offscreen, ctx };
}

function refreshSprite(letter) {
  const isNext = letter.index === collectedCount;
  drawLetterCanvas(letter.spriteData.ctx, letter.char, isNext, 256);
  letter.spriteData.texture.needsUpdate = true;
}

// ===== RANDOM TRACK POSITION =====
function getRandomTrackPos(avoid) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const idx = Math.floor(Math.random() * TRACK_SEGS.length);
    const seg = TRACK_SEGS[idx];
    const off = (Math.random() - 0.5) * (TRACK_WIDTH - 18);
    const nx = -seg.dy / seg.len, ny = seg.dx / seg.len;
    const px = seg.ax + nx * off, py = seg.ay + ny * off;
    if (!isOnTrack(px, py)) continue;
    let tooClose = false;
    if (avoid) {
      for (const a of avoid) {
        if (Math.hypot(a.x - px, a.y - py) < 65) { tooClose = true; break; }
      }
    }
    if (car && Math.hypot(car.x - px, car.y - py) < 90) tooClose = true;
    if (!tooClose) return { x: px, y: py };
  }
  const a = Math.random() * Math.PI * 2;
  return { x: CX + 270 * Math.cos(a), y: CZ + 175 * Math.sin(a) };
}

// ===== INIT CAR =====
function initCar() {
  const p0 = TRACK_PATH[0], p1 = TRACK_PATH[1];
  const base = (TRACKS[selectedTrack] || TRACKS.easy).carSpeed;
  return {
    x: p0.x, y: p0.y,
    angle: Math.atan2(p1.y - p0.y, p1.x - p0.x),
    speed: 0,
    maxSpeed: selectedLevel >= 2 ? base + 1.0 : base,
    accel: 0.09,
    friction: 0.972,
    turnSpeed: 0.046,
  };
}

// ===== SPAWN LETTERS =====
function spawnLetters() {
  // Remove old sprites
  while (letterGroup.children.length) letterGroup.remove(letterGroup.children[0]);

  letters = [];
  const word = currentWord.word.toUpperCase();

  for (let i = 0; i < word.length; i++) {
    const pos = getRandomTrackPos(letters);
    // Level 1: only first letter visible; Level 2: all visible immediately
    const visible = selectedLevel === 1 ? i === 0 : true;

    const entry = {
      x: pos.x, y: pos.y,
      char: word[i],
      index: i,
      collected: false,
      visible,
      bobPhase: Math.random() * Math.PI * 2,
      spriteData: null,
    };

    if (visible) {
      entry.spriteData = createLetterSprite(word[i], i === 0);
      entry.spriteData.sprite.position.set(pos.x - CX, 20, pos.y - CZ);
      letterGroup.add(entry.spriteData.sprite);
    }

    letters.push(entry);
  }
}

// ===== HUD =====
function updateHUD() {
  if (domScore)     domScore.textContent    = score;
  if (domLives)     domLives.textContent    = '❤️'.repeat(lives);
  if (domWords)     domWords.textContent    = wordsCompleted;
  if (domLevelNum)  domLevelNum.textContent = selectedLevel;
  if (domEmoji)     domEmoji.textContent    = currentWord.emoji || '❓';

  if (!domWordDisplay) return;
  const word = currentWord.word.toUpperCase();
  domWordDisplay.innerHTML = '';
  for (let i = 0; i < word.length; i++) {
    const span = document.createElement('span');
    span.className = 'letter-slot' +
      (i < collectedCount ? ' collected' : i === collectedCount ? ' next' : '');
    span.textContent = i < collectedCount ? word[i] : i === collectedCount ? word[i] : '_';
    domWordDisplay.appendChild(span);
  }
}

// ===== FLOATING MESSAGE =====
function showMsg(text, color) {
  if (!domMessage) return;
  domMessage.textContent = text;
  domMessage.style.color = color || '#fff';
  domMessage.style.opacity = '1';
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => { if (domMessage) domMessage.style.opacity = '0'; }, 1600);
}

// ===== NEXT WORD =====
function nextWord() {
  wordsCompleted++;
  const bonus = 50 + currentWord.word.length * 10;
  score += bonus;

  const nextIdx = Math.floor(Math.random() * words.length);
  currentWord = words[nextIdx];
  collectedCount = 0;
  spawnLetters();
  updateHUD();
  showMsg(`Wort geschafft! +${bonus}`, '#4ecca3');
}

// ===== CAMERA =====
function updateCamera() {
  const wx = car.x - CX;
  const wz = car.y - CZ;
  const ca = car.angle;

  camera.position.set(
    wx - Math.cos(ca) * 5,
    12,
    wz - Math.sin(ca) * 5
  );
  camera.lookAt(
    wx + Math.cos(ca) * 90,
    3,
    wz + Math.sin(ca) * 90
  );
}

// ===== SPEEDOMETER =====
function updateSpeedometer() {
  const pct = Math.abs(car.speed) / car.maxSpeed;
  const kmh = Math.round(pct * 180);
  if (domSpeedNum) domSpeedNum.textContent = kmh;
  if (domNeedle)   domNeedle.setAttribute('transform', `rotate(${-120 + pct * 240}, 50, 58)`);
}

// ===== UPDATE =====
function update() {
  if (gameState !== 'playing') return;
  tick++;

  // — Steering —
  if (keys['ArrowLeft']) {
    car.angle -= car.turnSpeed * (Math.abs(car.speed) / car.maxSpeed * 0.6 + 0.4);
    steeringAngle = Math.max(steeringAngle - 5, -140);
  } else if (keys['ArrowRight']) {
    car.angle += car.turnSpeed * (Math.abs(car.speed) / car.maxSpeed * 0.6 + 0.4);
    steeringAngle = Math.min(steeringAngle + 5, 140);
  } else {
    steeringAngle *= 0.85;
  }
  if (domSteering) domSteering.style.transform = `rotate(${steeringAngle}deg)`;

  // — Acceleration —
  if (keys['ArrowUp']) {
    car.speed = Math.min(car.speed + car.accel, car.maxSpeed);
  } else if (keys['ArrowDown']) {
    car.speed = Math.max(car.speed - car.accel * 1.5, -car.maxSpeed * 0.4);
  } else {
    car.speed *= car.friction;
    if (Math.abs(car.speed) < 0.04) car.speed = 0;
  }

  // — Move —
  car.x += Math.cos(car.angle) * car.speed;
  car.y += Math.sin(car.angle) * car.speed;

  // — Off-track penalty —
  if (!isOnTrack(car.x, car.y)) car.speed *= 0.62;

  // — Obstacle collision —
  for (const obs of obstacleObjects) {
    if (Math.hypot(car.x - obs.x, car.y - obs.y) < obs.radius + 6) {
      if (Math.abs(car.speed) > 0.4) {
        car.speed *= 0.55;
        showMsg('Kracht! 💥', '#FF5555');
      }
    }
  }

  // — Camera & speedometer —
  updateCamera();
  updateSpeedometer();

  // — Animate letter sprites (bob up/down) —
  for (const L of letters) {
    if (!L.visible || L.collected || !L.spriteData) continue;
    L.spriteData.sprite.position.y = 20 + Math.sin(tick * 0.04 + L.bobPhase) * 2.5;
  }

  // — Collect letters (must be in order) —
  for (const L of letters) {
    if (L.collected || !L.visible || L.index !== collectedCount) continue;
    if (Math.hypot(car.x - L.x, car.y - L.y) < 27) {
      // Collect!
      L.collected = true;
      if (L.spriteData) {
        letterGroup.remove(L.spriteData.sprite);
        L.spriteData = null;
      }
      collectedCount++;
      score += 10;
      showMsg('+10', '#4ecca3');

      if (collectedCount >= currentWord.word.length) {
        nextWord();
        return;
      }

      if (selectedLevel === 1) {
        // Reveal next letter
        const next = letters.find(l => l.index === collectedCount);
        if (next && !next.visible) {
          next.visible = true;
          next.spriteData = createLetterSprite(next.char, true);
          next.spriteData.sprite.position.set(next.x - CX, 20, next.y - CZ);
          letterGroup.add(next.spriteData.sprite);
        }
      } else {
        // Level 2: update next letter highlight
        const next = letters.find(l => l.index === collectedCount && !l.collected);
        if (next && next.spriteData) refreshSprite(next);
      }

      updateHUD();
    }
  }
}

// ===== GAME LOOP =====
function gameLoop() {
  update();
  renderer.render(scene, camera);
  if (gameState === 'playing') animId = requestAnimationFrame(gameLoop);
}

// ===== START GAME =====
function startGame(level, track) {
  selectedLevel = level || 1;
  selectedTrack = track || 'easy';

  // Build track geometry first (sets TRACK_PATH / TRACK_SEGS)
  activateTrack(selectedTrack);
  rebuildTrack3D();

  words = loadWords();
  if (!words.length) words = [{ word: 'HALLO', hint: 'Begrüßung', emoji: '👋', category: '', difficulty: 'easy' }];

  currentWord    = words[Math.floor(Math.random() * words.length)];
  collectedCount = 0;
  score          = 0;
  lives          = 3;
  wordsCompleted = 0;
  steeringAngle  = 0;
  tick           = 0;
  gameState      = 'playing';
  car            = initCar();

  spawnLetters();
  updateHUD();
  document.getElementById('overlay').style.display = 'none';

  if (animId) cancelAnimationFrame(animId);
  gameLoop();
}

// ===== INPUT =====
document.addEventListener('keydown', e => {
  keys[e.key] = true;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.key] = false; });

// ===== TOUCH CONTROLS =====
function bindTouch(btnId, key) {
  const el = document.getElementById(btnId);
  if (!el) return;
  el.addEventListener('touchstart', e => { e.preventDefault(); keys[key] = true; }, { passive: false });
  el.addEventListener('touchend',   () => { keys[key] = false; });
  el.addEventListener('touchcancel',() => { keys[key] = false; });
}

// ===== INIT ON LOAD =====
window.addEventListener('load', () => {
  domSteering  = document.getElementById('steering-wheel');
  domEmoji     = document.getElementById('word-emoji');
  domWordDisplay = document.getElementById('word-display');
  domScore     = document.getElementById('score-val');
  domLives     = document.getElementById('lives-val');
  domWords     = document.getElementById('words-val');
  domLevelNum  = document.getElementById('level-num');
  domSpeedNum  = document.getElementById('speed-num');
  domNeedle    = document.getElementById('speed-needle');
  domMessage   = document.getElementById('game-message');

  initScene();

  // Bind touch controls
  bindTouch('touch-left',  'ArrowLeft');
  bindTouch('touch-right', 'ArrowRight');
  bindTouch('touch-up',    'ArrowUp');
  bindTouch('touch-down',  'ArrowDown');

  // Level button toggle
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Track button toggle
  document.querySelectorAll('.track-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.track-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('btn-start').addEventListener('click', () => {
    const activeLevel = document.querySelector('.level-btn.active');
    const activeTrack = document.querySelector('.track-btn.active');
    startGame(
      activeLevel ? parseInt(activeLevel.dataset.level) : 1,
      activeTrack ? activeTrack.dataset.track : 'easy'
    );
  });
});
