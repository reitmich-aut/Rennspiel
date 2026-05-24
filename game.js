// ===== CONSTANTS =====
const CANVAS_W = 800, CANVAS_H = 440;
const CX = CANVAS_W / 2;   // 400 — canvas center X (= world origin X)
const CZ = CANVAS_H / 2;   // 270 — canvas center Y (= world origin Z)
const TRACK_WIDTH = 72;
const BORDER_W = 6;

// ===== TRACK PATH (oval, same math as before) =====
function buildTrackPath() {
  const pts = [];
  const rx = 290, ry = 195;
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: CX + rx * Math.cos(a), y: CZ + ry * Math.sin(a) });
  }
  return pts;
}

const TRACK_PATH = buildTrackPath();
const TRACK_SEGS = [];
for (let i = 0; i < TRACK_PATH.length - 1; i++) {
  const a = TRACK_PATH[i], b = TRACK_PATH[i + 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  TRACK_SEGS.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, dx, dy, len });
}

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
let steeringAngle = 0;
let tick = 0;
let messageTimer = null;

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

  // Track
  buildTrack3D();

  // Letter group
  letterGroup = new THREE.Group();
  scene.add(letterGroup);

  // Decorative trees around oval
  addTrees();
}

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

  scene.add(makeMeshFromVerts(aspVerts, 0x7B7B7B)); // cobblestone
  scene.add(makeMeshFromVerts(borVerts, 0xAAAAAA)); // stone border
  scene.add(makeMeshFromVerts(dashVerts, 0xFFFFFF)); // white center line

  // Simplified start/finish: single white stripe
  const seg0 = TRACK_SEGS[0];
  const snx = -seg0.dy / seg0.len, snz = seg0.dx / seg0.len;
  const sax = seg0.ax - CX, saz = seg0.ay - CZ;
  const sbx = seg0.bx - CX, sbz = seg0.by - CZ;
  const hw2 = TRACK_WIDTH / 2;
  const sfW = [];
  const sfB = [];
  const cw = TRACK_WIDTH / 4;
  for (let c = 0; c < 4; c++) {
    const l = -hw2 + c * cw, r = l + cw;
    (c % 2 === 0 ? sfW : sfB).push(...[
      sax + snx * l, 0.035, saz + snz * l,
      sax + snx * r, 0.035, saz + snz * r,
      sbx + snx * l, 0.035, sbz + snz * l,
      sax + snx * r, 0.035, saz + snz * r,
      sbx + snx * r, 0.035, sbz + snz * r,
      sbx + snx * l, 0.035, sbz + snz * l,
    ]);
  }
  scene.add(makeMeshFromVerts(sfW, 0xffffff));
  scene.add(makeMeshFromVerts(sfB, 0x111111));
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
  return {
    x: p0.x, y: p0.y,
    angle: Math.atan2(p1.y - p0.y, p1.x - p0.x),
    speed: 0,
    maxSpeed: selectedLevel >= 2 ? 3.8 : 2.8,
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
function startGame(level) {
  words = loadWords();
  if (!words.length) words = [{ word: 'HALLO', hint: 'Begrüßung', emoji: '👋', category: '', difficulty: 'easy' }];

  selectedLevel  = level || 1;
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

  // Level button toggle
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('btn-start').addEventListener('click', () => {
    const active = document.querySelector('.level-btn.active');
    startGame(active ? parseInt(active.dataset.level) : 1);
  });
});
