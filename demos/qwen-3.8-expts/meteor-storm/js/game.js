'use strict';

const CFG = {
  BOUND_X: 11,
  BOUND_Y: 6.5,
  SHIP_ACCEL: 75,
  SHIP_DAMPING: 7,
  SHIP_MAX_SPEED: 20,
  SHIP_HIT_RADIUS: 0.95,
  FIRE_COOLDOWN: 0.15,
  BULLET_SPEED: 95,
  BULLET_DEAD_Z: -170,
  INVULN_TIME: 2.0,
  START_LIVES: 3,
  MAX_LIVES: 6,
  EXTRA_LIVE_STEP: 1500,
  WAVE_LENGTH: 25,
  SPAWN_INTERVAL_START: 1.0,
  SPAWN_INTERVAL_MIN: 0.26,
  SPAWN_RAMP: 0.012,
  METEOR_BASE_SPEED: 12.5,
  METEOR_WAVE_SPEED: 0.8,
  METEOR_SPEED_RANGE: 6,
  METEOR_AIM_X: 5,
  METEOR_AIM_Y: 3.5,
  STAR_COUNT: 1400,
  STAR_SPEED: 17,
  STAR_MENU_SPEED: 7,
  STAR_SPAN_X: 95,
  STAR_SPAN_Y: 60,
  STAR_Z_MIN: -185,
  STAR_Z_MAX: 15,
  PARTICLES_PER_EXPLOSION: 14,
  EXPLOSION_SPEED: 9,
  EXPLOSION_LIFE: 0.7,
  HIGH_SCORE_KEY: 'meteorStormHigh'
};

const TIERS = [
  { radius: 0.65, color: 0xaabdd2, score: 50, speed: 1.3, detail: 0, split: 0 },
  { radius: 1.35, color: 0x8fa0b3, score: 25, speed: 1.05, detail: 1, split: 2 },
  { radius: 2.5, color: 0x77879c, score: 10, speed: 0.78, detail: 1, split: 3 }
];

let renderer, scene, camera, clock;
let ship, flame, flameLight;
let bulletGeo, bulletMat;
let shardGeo;
let starGeo, starPos;

const bullets = [];
const meteors = [];
const particles = [];

const keys = {};
let mouseFire = false;
let touchTarget = null;
const shipVel = new THREE.Vector3();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();

let state = 'menu';
let paused = false;
let score = 0;
let highScore = 0;
let lives = CFG.START_LIVES;
let wave = 1;
let elapsed = 0;
let spawnTimer = 0.5;
let fireTimer = 0;
let shotSide = 1;
let invuln = 0;
let shake = 0;
let timeScale = 1;
let extraLifeAt = CFG.EXTRA_LIVE_STEP;
let newRecord = false;
let deadAt = 0;
let lastScore = -1, lastHigh = -1, lastLives = -1, lastWave = -1;
const RESTART_LOCKOUT_MS = 800;

const $ = (id) => document.getElementById(id);
const els = {
  hud: $('hud'),
  score: $('score'),
  high: $('high'),
  lives: $('lives'),
  wave: $('wave-badge'),
  toast: $('toast'),
  hint: $('hint'),
  overlay: $('overlay'),
  box: $('overlay-box'),
  title: $('overlay-title'),
  sub: $('overlay-sub'),
  controls: $('overlay-controls'),
  go: $('overlay-go')
};

const pad = (n) => String(n).padStart(6, '0');
const clamp = THREE.MathUtils.clamp;

function loadHigh() {
  try { return parseInt(localStorage.getItem(CFG.HIGH_SCORE_KEY), 10) || 0; }
  catch (e) { return 0; }
}

function saveHigh() {
  try { localStorage.setItem(CFG.HIGH_SCORE_KEY, String(highScore)); }
  catch (e) {}
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove('show');
  void els.toast.offsetWidth;
  els.toast.classList.add('show');
}

function showOverlay(title, subHtml, goText, showControls) {
  els.title.textContent = title;
  els.title.className = title.length > 12 ? 'small' : '';
  els.sub.innerHTML = subHtml;
  els.go.textContent = goText;
  els.controls.style.display = showControls ? 'block' : 'none';
  els.box.style.animation = 'none';
  void els.box.offsetWidth;
  els.box.style.animation = '';
}

function showMenu() {
  const best = highScore > 0 ? ` &nbsp;·&nbsp; BEST <span class="accent">${pad(highScore)}</span>` : '';
  showOverlay('METEOR STORM',
    'THE SHARD FIELD IS FALLING<br />SPLIT THE ROCKS · SURVIVE THE WAVES' + best,
    'CLICK OR PRESS SPACE TO LAUNCH', true);
}

function showGameOver() {
  const best = newRecord ? ' &nbsp;·&nbsp; <span class="accent">NEW BEST</span>' : '';
  showOverlay('GAME OVER', `FINAL SCORE <span class="accent">${pad(score)}</span>${best}`,
    'CLICK OR PRESS SPACE TO FLY AGAIN', false);
}

function canRestart() {
  return performance.now() - deadAt > RESTART_LOCKOUT_MS;
}

function showPaused() {
  showOverlay('PAUSED', 'THE FIELD HOLDS ITS BREATH', 'PRESS P TO RESUME', false);
}

/* ---------------- ship ---------------- */

function buildShip() {
  ship = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xd7e1f0, metalness: 0.55, roughness: 0.35, flatShading: true
  });

  const bodyGeo = new THREE.ConeGeometry(0.55, 2.1, 4);
  bodyGeo.rotateX(-Math.PI / 2);
  ship.add(new THREE.Mesh(bodyGeo, bodyMat));

  const wingGeo = new THREE.BoxGeometry(3.0, 0.1, 0.8);
  wingGeo.translate(0, 0, 0.45);
  const wing = new THREE.Mesh(wingGeo, bodyMat);
  wing.position.y = -0.2;
  wing.rotation.z = 0.12;
  ship.add(wing);

  const tipMat = new THREE.MeshBasicMaterial({ color: 0x35c8ff });
  const tipGeoR = new THREE.BoxGeometry(0.14, 0.16, 0.8);
  tipGeoR.translate(1.5, 0, 0.45);
  const tipR = new THREE.Mesh(tipGeoR, tipMat);
  tipR.position.y = -0.2;
  ship.add(tipR);
  const tipGeoL = tipGeoR.clone();
  tipGeoL.translate(-3.0, 0, 0);
  const tipL = new THREE.Mesh(tipGeoL, tipMat);
  tipL.position.y = -0.2;
  ship.add(tipL);

  const finGeo = new THREE.BoxGeometry(0.1, 0.55, 0.7);
  const fin = new THREE.Mesh(finGeo, bodyMat);
  fin.position.set(0, 0.32, 0.5);
  ship.add(fin);

  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0x7de3ff })
  );
  cockpit.scale.set(1, 0.8, 1.5);
  cockpit.position.set(0, 0.18, -0.25);
  ship.add(cockpit);

  const flameGeo = new THREE.ConeGeometry(0.22, 1.1, 8);
  flameGeo.rotateX(Math.PI / 2);
  flameGeo.translate(0, 0, 0.55);
  flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({
    color: 0xff9040, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  flame.position.set(0, -0.05, 1.0);
  ship.add(flame);

  flameLight = new THREE.PointLight(0xff8030, 1.6, 10, 2);
  flameLight.position.set(0, 0, 1.6);
  ship.add(flameLight);

  scene.add(ship);

  shardGeo = new THREE.TetrahedronGeometry(0.16);
  bulletGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.4, 6);
  bulletGeo.rotateX(Math.PI / 2);
  bulletMat = new THREE.MeshBasicMaterial({
    color: 0x7df0c8, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
}

/* ---------------- starfield ---------------- */

function buildStars() {
  starGeo = new THREE.BufferGeometry();
  starPos = new Float32Array(CFG.STAR_COUNT * 3);
  for (let i = 0; i < CFG.STAR_COUNT; i++) {
    starPos[i * 3] = (Math.random() * 2 - 1) * CFG.STAR_SPAN_X;
    starPos[i * 3 + 1] = (Math.random() * 2 - 1) * CFG.STAR_SPAN_Y;
    starPos[i * 3 + 2] = CFG.STAR_Z_MIN + Math.random() * (CFG.STAR_Z_MAX - CFG.STAR_Z_MIN);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xa9c3ff, size: 0.5, sizeAttenuation: true,
    transparent: true, opacity: 0.9, depthWrite: false
  });
  scene.add(new THREE.Points(starGeo, mat));
}

function updateStars(dt, speed) {
  for (let i = 0; i < CFG.STAR_COUNT; i++) {
    const j = i * 3;
    starPos[j + 2] += speed * dt;
    if (starPos[j + 2] > CFG.STAR_Z_MAX) {
      starPos[j + 2] = CFG.STAR_Z_MIN;
      starPos[j] = (Math.random() * 2 - 1) * CFG.STAR_SPAN_X;
      starPos[j + 1] = (Math.random() * 2 - 1) * CFG.STAR_SPAN_Y;
    }
  }
  starGeo.attributes.position.needsUpdate = true;
}

/* ---------------- meteors ---------------- */

function rockScale(x, y, z, seed) {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453;
  return 1 + (h - Math.floor(h) - 0.5) * 0.42;
}

function spawnMeteor(tier, pos, vel) {
  const t = TIERS[tier];
  const geo = new THREE.IcosahedronGeometry(t.radius, t.detail);
  const seed = Math.random() * 100;
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const s = rockScale(x, y, z, seed);
    p.setXYZ(i, x * s, y * s, z * s);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(t.color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.1),
    flatShading: true, roughness: 0.9, metalness: 0.15
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(pos);
  m.userData = {
    tier,
    radius: t.radius * 1.28,
    vel: vel.clone(),
    rotV: new THREE.Vector3(
      (Math.random() - 0.5) * 3,
      (Math.random() - 0.5) * 3,
      (Math.random() - 0.5) * 3
    )
  };
  meteors.push(m);
  scene.add(m);
}

function spawnIncomingMeteor() {
  const tier = Math.random() < 0.22 ? 1 : 2;
  const angle = Math.random() * Math.PI * 2;
  const rad = 26 + Math.random() * 30;
  vC.set(
    Math.cos(angle) * rad,
    Math.sin(angle) * rad * 0.55,
    -85 - Math.random() * 40
  );
  vA.set(
    ship.position.x + (Math.random() * 2 - 1) * CFG.METEOR_AIM_X,
    ship.position.y + (Math.random() * 2 - 1) * CFG.METEOR_AIM_Y,
    -2
  );
  const speed =
    (CFG.METEOR_BASE_SPEED + (wave - 1) * CFG.METEOR_WAVE_SPEED +
      Math.random() * CFG.METEOR_SPEED_RANGE) * TIERS[tier].speed;
  const vel = vB.copy(vA).sub(vC).normalize().multiplyScalar(speed);
  spawnMeteor(tier, vC, vel);
}

function removeMeteor(index) {
  const m = meteors[index];
  scene.remove(m);
  m.geometry.dispose();
  m.material.dispose();
  meteors.splice(index, 1);
}

function breakMeteor(index) {
  const m = meteors[index];
  const tier = m.userData.tier;
  const t = TIERS[tier];
  addScore(t.score);
  spawnExplosion(m.position, 0.5 + tier * 0.45, 0xffa050, 10 + tier * 4, CFG.EXPLOSION_SPEED + tier * 3);
  Sfx.explode(tier);
  shake = Math.min(1.2, shake + 0.05 + tier * 0.05);
  if (t.split > 0) {
    for (let i = 0; i < t.split; i++) {
      const childPos = m.position.clone();
      const childVel = m.userData.vel.clone().multiplyScalar(0.7);
      childVel.x += (Math.random() - 0.5) * 9;
      childVel.y += (Math.random() - 0.5) * 6;
      childVel.z += 2 + Math.random() * 4;
      spawnMeteor(tier - 1, childPos, childVel);
    }
  }
  removeMeteor(index);
  updateHud();
}

function updateMeteors(dt, checkShip) {
  const shipR = CFG.SHIP_HIT_RADIUS;
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i];
    const ud = m.userData;
    m.position.addScaledVector(ud.vel, dt);
    m.rotation.x += ud.rotV.x * dt;
    m.rotation.y += ud.rotV.y * dt;
    m.rotation.z += ud.rotV.z * dt;

    if (m.position.z > 18) {
      removeMeteor(i);
      continue;
    }

    if (checkShip) {
      const dx = m.position.x - ship.position.x;
      const dy = m.position.y - ship.position.y;
      const dz = m.position.z - ship.position.z;
      const rr = ud.radius + shipR;
      if (dx * dx + dy * dy + dz * dz < rr * rr) {
        breakMeteor(i);
        hitShip();
        continue;
      }
    }
  }
}

/* ---------------- bullets ---------------- */

function fireBullet() {
  shotSide = -shotSide;
  const b = new THREE.Mesh(bulletGeo, bulletMat);
  b.position.set(
    ship.position.x + 0.62 * shotSide,
    ship.position.y - 0.12,
    ship.position.z - 1.0
  );
  bullets.push(b);
  scene.add(b);
  Sfx.shoot();
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.position.z -= CFG.BULLET_SPEED * dt;
    if (b.position.z < CFG.BULLET_DEAD_Z) {
      scene.remove(b);
      bullets.splice(i, 1);
      continue;
    }
    for (let j = meteors.length - 1; j >= 0; j--) {
      const m = meteors[j];
      if (m.position.z < -40) continue;
      const dx = m.position.x - b.position.x;
      const dy = m.position.y - b.position.y;
      const dz = m.position.z - b.position.z;
      const rr = m.userData.radius + 0.35;
      if (dx * dx + dy * dy + dz * dz < rr * rr) {
        scene.remove(b);
        bullets.splice(i, 1);
        breakMeteor(j);
        break;
      }
    }
  }
}

/* ---------------- explosions ---------------- */

function spawnExplosion(pos, size, color, count, speed) {
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const p = new THREE.Mesh(shardGeo, mat);
    p.position.copy(pos);
    const life = CFG.EXPLOSION_LIFE * (0.6 + Math.random() * 0.7);
    vA.set(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2
    ).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.9));
    particles.push({
      mesh: p, vel: vA.clone(),
      life, maxLife: life,
      size: size * (0.5 + Math.random() * 0.8),
      spin: (Math.random() - 0.5) * 12
    });
    scene.add(p);
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.life -= dt;
    if (pt.life <= 0) {
      scene.remove(pt.mesh);
      pt.mesh.material.dispose();
      particles.splice(i, 1);
      continue;
    }
    pt.mesh.position.addScaledVector(pt.vel, dt);
    pt.vel.multiplyScalar(Math.exp(-1.8 * dt));
    const k = pt.life / pt.maxLife;
    pt.mesh.scale.setScalar(Math.max(0.001, k) * pt.size);
    pt.mesh.rotation.x += pt.spin * dt;
    pt.mesh.rotation.y += pt.spin * 0.7 * dt;
    pt.mesh.material.opacity = k;
  }
}

/* ---------------- ship & camera ---------------- */

function updateShip(dt) {
  let ix = 0, iy = 0;
  if (keys['ArrowLeft'] || keys['KeyA']) ix -= 1;
  if (keys['ArrowRight'] || keys['KeyD']) ix += 1;
  if (keys['ArrowUp'] || keys['KeyW']) iy += 1;
  if (keys['ArrowDown'] || keys['KeyS']) iy -= 1;

  if (touchTarget && ix === 0 && iy === 0) {
    const distZ = camera.position.z - ship.position.z;
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * distZ;
    const halfW = halfH * camera.aspect;
    const tx = (touchTarget.x / window.innerWidth * 2 - 1) * halfW;
    const ty = (1 - touchTarget.y / window.innerHeight * 2) * halfH + camera.position.y * 0.55;
    const dx = tx - ship.position.x;
    const dy = ty - ship.position.y;
    shipVel.x += dx * 10 * dt;
    shipVel.y += dy * 10 * dt;
  } else if (ix || iy) {
    if (ix && iy) { ix *= 0.7071; iy *= 0.7071; }
    shipVel.x += ix * CFG.SHIP_ACCEL * dt;
    shipVel.y += iy * CFG.SHIP_ACCEL * dt;
  }

  const damp = Math.exp(-CFG.SHIP_DAMPING * dt);
  shipVel.x *= damp;
  shipVel.y *= damp;
  const v = Math.hypot(shipVel.x, shipVel.y);
  if (v > CFG.SHIP_MAX_SPEED) {
    const k = CFG.SHIP_MAX_SPEED / v;
    shipVel.x *= k;
    shipVel.y *= k;
  }
  ship.position.x = clamp(ship.position.x + shipVel.x * dt, -CFG.BOUND_X, CFG.BOUND_X);
  ship.position.y = clamp(ship.position.y + shipVel.y * dt, -CFG.BOUND_Y, CFG.BOUND_Y);
  ship.position.z = 0;

  ship.rotation.z = -shipVel.x * 0.035;
  ship.rotation.x = shipVel.y * 0.03;
  ship.rotation.y = -shipVel.x * 0.015;

  flame.scale.set(1, 1, 0.75 + Math.random() * 0.55);
  flameLight.intensity = 1.2 + Math.random() * 0.9;

  if (invuln > 0) {
    invuln -= dt;
    ship.visible = Math.floor(invuln * 14) % 2 === 0;
  } else {
    ship.visible = true;
  }

  fireTimer -= dt;
  if ((keys['Space'] || mouseFire || touchTarget) && fireTimer <= 0) {
    fireTimer = CFG.FIRE_COOLDOWN;
    fireBullet();
  }
}

function updateCamera(dt) {
  const k = 1 - Math.exp(-6 * dt);
  const tx = ship.position.x * 0.55;
  const ty = 3.4 + ship.position.y * 0.25;
  camera.position.x += (tx - camera.position.x) * k;
  camera.position.y += (ty - camera.position.y) * k;
  camera.position.z = 15;
  if (shake > 0.001) {
    camera.position.x += (Math.random() * 2 - 1) * shake * 0.4;
    camera.position.y += (Math.random() * 2 - 1) * shake * 0.4;
  }
  camera.lookAt(ship.position.x * 0.65, ship.position.y * 0.55, -30);
  shake = Math.max(0, shake - dt * 2.0);
}

/* ---------------- flow ---------------- */

function addScore(n) {
  score += n;
  while (score >= extraLifeAt && lives < CFG.MAX_LIVES) {
    extraLifeAt += CFG.EXTRA_LIVE_STEP;
    lives++;
    Sfx.extraLife();
    showToast('EXTRA SHARD');
  }
}

function hitShip() {
  if (invuln > 0) return;
  lives--;
  invuln = CFG.INVULN_TIME;
  shake = 1.3;
  timeScale = 0.3;
  ship.visible = false;
  Sfx.hit();
  spawnExplosion(ship.position, 1.4, 0x88ddff, CFG.PARTICLES_PER_EXPLOSION + 8, CFG.EXPLOSION_SPEED + 5);
  if (lives <= 0) gameOver();
}

function updateHud() {
  if (score !== lastScore) {
    els.score.textContent = pad(score);
    lastScore = score;
  }
  if (highScore !== lastHigh) {
    els.high.textContent = pad(highScore);
    lastHigh = highScore;
  }
  if (lives !== lastLives) {
    let h = '';
    for (let i = 0; i < CFG.MAX_LIVES; i++) {
      h += i < lives ? '<span></span>' : '<span class="off"></span>';
    }
    els.lives.innerHTML = h;
    lastLives = lives;
  }
  if (wave !== lastWave) {
    els.wave.textContent = 'WAVE ' + wave;
    lastWave = wave;
  }
}

function startGame() {
  for (let i = bullets.length - 1; i >= 0; i--) scene.remove(bullets[i]);
  bullets.length = 0;
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i];
    scene.remove(m);
    m.geometry.dispose();
    m.material.dispose();
  }
  meteors.length = 0;
  for (let i = particles.length - 1; i >= 0; i--) {
    scene.remove(particles[i].mesh);
    particles[i].mesh.material.dispose();
  }
  particles.length = 0;

  score = 0;
  lives = CFG.START_LIVES;
  wave = 1;
  elapsed = 0;
  spawnTimer = 0.6;
  fireTimer = 0;
  invuln = 1.2;
  shake = 0;
  timeScale = 1;
  extraLifeAt = CFG.EXTRA_LIVE_STEP;
  ship.position.set(0, 0, 0);
  ship.rotation.set(0, 0, 0);
  shipVel.set(0, 0, 0);
  ship.visible = true;
  state = 'playing';
  paused = false;
  Sfx.launch();
  showToast('WAVE 1');
  els.overlay.style.display = 'none';
  els.hud.classList.add('on');
  els.hint.classList.add('on');
  updateHud();
}

function gameOver() {
  state = 'over';
  deadAt = performance.now();
  mouseFire = false;
  touchTarget = null;
  ship.visible = false;
  spawnExplosion(ship.position, 2, 0xff7744, CFG.PARTICLES_PER_EXPLOSION + 16, CFG.EXPLOSION_SPEED + 8);
  Sfx.gameOver();
  newRecord = score > highScore && highScore > 0;
  highScore = Math.max(highScore, score);
  saveHigh();
  els.hud.classList.remove('on');
  els.hint.classList.remove('on');
  els.title.textContent = 'GAME OVER';
  els.title.className = '';
  els.sub.innerHTML = 'SIGNAL LOST';
  els.go.textContent = '';
  els.overlay.style.display = 'flex';
  setTimeout(() => {
    if (state === 'over') showGameOver();
  }, 700);
}

function togglePause() {
  if (state !== 'playing') return;
  paused = !paused;
  if (paused) {
    els.overlay.style.display = 'flex';
    showPaused();
  } else {
    els.overlay.style.display = 'none';
  }
}

/* ---------------- input ---------------- */

function onKeyDown(e) {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) {
    e.preventDefault();
  }
  keys[e.code] = true;
  Sfx.ensure();
  if (e.code === 'Space' && (state === 'menu' || (state === 'over' && canRestart()))) {
    startGame();
  }
  if (e.code === 'KeyR' && state === 'over' && canRestart()) startGame();
  if (e.code === 'KeyP') togglePause();
  if (e.code === 'KeyM') {
    Sfx.ensure();
    Sfx.toggleMute();
  }
}

function onKeyUp(e) {
  keys[e.code] = false;
}

function onMouseDown(e) {
  Sfx.ensure();
  if (state === 'menu') startGame();
  else if (state === 'over' && canRestart()) startGame();
  else if (state === 'playing') mouseFire = true;
}

function onMouseUp() {
  mouseFire = false;
}

function onTouchStart(e) {
  Sfx.ensure();
  if (state === 'menu' || (state === 'over' && canRestart())) {
    startGame();
    return;
  }
  const t = e.touches[0];
  touchTarget = { x: t.clientX, y: t.clientY };
  e.preventDefault();
}

function onTouchMove(e) {
  const t = e.touches[0];
  touchTarget = { x: t.clientX, y: t.clientY };
  e.preventDefault();
}

function onTouchEnd() {
  touchTarget = null;
}

function onBlur() {
  if (state === 'playing' && !paused) {
    mouseFire = false;
    touchTarget = null;
    for (const k in keys) keys[k] = false;
    togglePause();
  }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* ---------------- main loop ---------------- */

function updatePlaying(dt) {
  elapsed += dt;
  const nw = 1 + Math.floor(elapsed / CFG.WAVE_LENGTH);
  if (nw > wave) {
    wave = nw;
    showToast('WAVE ' + wave);
    Sfx.wave();
  }

  updateShip(dt);

  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    const base = Math.max(CFG.SPAWN_INTERVAL_MIN, CFG.SPAWN_INTERVAL_START - elapsed * CFG.SPAWN_RAMP);
    spawnTimer = base * (0.7 + Math.random() * 0.6);
    spawnIncomingMeteor();
  }

  updateMeteors(dt, true);
  updateBullets(dt);
  updateParticles(dt);
}

function updateAmbient(dt) {
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = 1.1;
    spawnIncomingMeteor();
  }
  updateMeteors(dt, false);
  updateBullets(dt);
  updateParticles(dt);
}

function animate() {
  requestAnimationFrame(animate);
  let rdt = Math.min(clock.getDelta(), 0.05);
  timeScale += (1 - timeScale) * Math.min(1, rdt * 3);
  const dt = rdt * timeScale;

  if (!paused) {
    updateStars(dt, state === 'playing' ? CFG.STAR_SPEED : CFG.STAR_MENU_SPEED);
    if (state === 'playing') {
      updatePlaying(dt);
    } else if (state === 'over') {
      updateAmbient(dt);
    } else {
      const t = clock.elapsedTime;
      ship.visible = true;
      ship.position.x = Math.sin(t * 0.5) * 1.5;
      ship.position.y = Math.sin(t * 0.73) * 0.8;
      ship.rotation.z = Math.cos(t * 0.5) * 0.15;
      flame.scale.set(1, 1, 0.75 + Math.random() * 0.55);
    }
    if (state !== 'menu') updateCamera(dt);
    updateHud();
  }
  renderer.render(scene, camera);
}

/* ---------------- init ---------------- */

function init() {
  highScore = loadHigh();

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  $('app').prepend(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04050c);
  scene.fog = new THREE.FogExp2(0x04050c, 0.011);

  camera = new THREE.PerspectiveCamera(
    62, window.innerWidth / window.innerHeight, 0.1, 400
  );
  camera.position.set(0, 3.6, 15);

  scene.add(new THREE.HemisphereLight(0x44558c, 0x0a0a14, 0.85));
  const key = new THREE.DirectionalLight(0xbfd4ff, 0.9);
  key.position.set(6, 12, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x2b4a8f, 0.5);
  rim.position.set(-8, -4, -10);
  scene.add(rim);

  buildStars();
  buildShip();

  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('touchstart', onTouchStart, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd);

  clock = new THREE.Clock();
  updateHud();
  showMenu();
  animate();
}

init();
