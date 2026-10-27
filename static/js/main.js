import * as THREE from 'three';
import { Track, buildWorld, gridSlot, setRoadWidth } from './track.js';
import { CarPhysics, collide, clamp, wrapAngle } from './physics.js';
import { initTextureDecoder, loadCarModels, ensureCar, carLoaded, CarVisual, CARS, CAR_IDS, POLICE_CAR, VEHICLE_CREDITS, vehicleOpts, vehicleMass } from './cars.js';
import { Traffic, loadTrafficModels, loadNearModel } from './traffic.js';
import { Particles, Skidmarks, Rain } from './fx.js';
import { buildTokyo } from './tokyo.js';
import { Music } from './music.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { HUD, fmt, esc } from './hud.js';
import { Input } from './input.js';
import { Pursuit } from './pursuit.js';
import { addSky, applySky, buildEnvironment, createComposer, FOG_COLOR } from './scene.js';
import { THEMES } from './themes.js';
import { planLandmarks } from './landmarks.js';
import { planPois, buildPois } from './pois.js';
import { chunkStatic } from './chunk.js';
import { buildIndia } from './india.js';

const $ = (id) => document.getElementById(id);
const PAINTS = ['#c00000', '#ff5a00', '#ffc400', '#2fbf3a', '#00a3ff', '#2338ff', '#7b2cff', '#ff2e88', '#f2f2f2', '#15171c', '#7a7f88', '#0d5c4a'];
const STEP = 1 / 120;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0008);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 6000);
const sky = addSky(scene);
scene.environment = buildEnvironment(renderer);
scene.add(new THREE.HemisphereLight(0x3a4a70, 0x1a1008, 0.55));
const moon = new THREE.DirectionalLight(0x9fb4ff, 0.35);
moon.position.set(-400, 380, -700);
scene.add(moon);

const lampLights = [];
for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffa65a, 0, 34, 1.6); scene.add(l); lampLights.push(l); }
const copLights = [];
for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xff0000, 0, 30, 1.6); scene.add(l); copLights.push(l); }
const heads = [0].map(() => { // one centred beam: each light costs every lit pixel
  const s = new THREE.SpotLight(0xfff1d8, 0, 110, 0.5, 0.6, 1.4);
  scene.add(s, s.target);
  return s;
});

const { composer, bloom, grade, smaa } = createComposer(renderer, scene, camera);
initTextureDecoder(renderer);

let track = new Track();
let world = null, props = null, city = null, trafficModels = null, mapIndex = [];
const mapCache = {};
let traffic = null, policeWarm = null;
const smoke = new Particles(scene, 900, [0.3, 0.31, 0.36], false);
const sparks = new Particles(scene, 500, [5, 2.2, 0.6], true);
const skids = new Skidmarks(scene);
const rain = new Rain(scene);

// Graphics presets. Every dynamic light costs every lit pixel, so counts stay small; AUTO benchmarks in the lobby
// (see autoBench) so the preset never changes mid-race, which would recompile every shader.
const QUALITY = {
  high: { pr: 1.25, msaa: 0, smaa: true, lamps: 3, cops: 2, rain: 2600, bloom: true, blur: true, traffic: 520 },
  medium: { pr: 1.0, msaa: 0, smaa: true, lamps: 2, cops: 1, rain: 1400, bloom: true, blur: true, traffic: 400 },
  low: { pr: 0.75, msaa: 0, smaa: false, lamps: 0, cops: 1, rain: 700, bloom: false, blur: false, traffic: 280 },
};
let gfxSetting = 'auto';
try { gfxSetting = localStorage.getItem('nh.gfx') || 'auto'; } catch { /* ignore */ }
let Q = QUALITY.high, qName = 'high';
const perf = { t: 0, n: 0, fps: 60 };
function applyQuality(name) {
  qName = name; Q = QUALITY[name];
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples !== Q.msaa) { rt.samples = Q.msaa; rt.dispose(); }
  lampLights.forEach((l, i) => { l.visible = i < Q.lamps; });
  copLights.forEach((l, i) => { l.visible = i < Q.cops; });
  bloom.enabled = Q.bloom;
  smaa.enabled = Q.smaa;
  rain.setCount(Q.rain);
  if (traffic) traffic.drawDist = Q.traffic;
  onResize();
  for (const b of document.querySelectorAll('#gfxSeg button')) b.classList.toggle('on', b.dataset.gfx === gfxSetting);
}
// AUTO: in the lobby and during the start countdown, try HIGH then step down until the scene holds ~55 fps, so the
// preset is settled before the green light. Mid-race, a sustained drop under ~45 fps still steps down.
const bench = { t: 0, n: 0, done: false, slowT: 0 };
function autoBench(dt) {
  const settling = G.phase === 'menu' || (G.phase === 'race' && net.now() < G.startAt);
  if (gfxSetting !== 'auto' || bench.done || !settling || document.hidden) return;
  bench.t += dt; bench.n++;
  if (bench.t < 1.5) return;
  const avg = bench.t / bench.n;
  bench.t = 0; bench.n = 0;
  if (avg > 1 / 55 && qName !== 'low') applyQuality(qName === 'high' ? 'medium' : 'low');
  else bench.done = true;
}
function trackPerf(dt) {
  autoBench(dt);
  perf.t += dt; perf.n++;
  if (perf.t < 3) return;
  const avg = perf.t / perf.n;
  perf.fps = Math.round(1 / avg);
  perf.t = 0; perf.n = 0;
  bench.slowT = gfxSetting === 'auto' && G.phase === 'race' && net.now() > G.startAt && avg > 1 / 45 ? bench.slowT + 3 : 0;
  if (bench.slowT >= 6 && qName !== 'low') {
    bench.slowT = 0;
    applyQuality(qName === 'high' ? 'medium' : 'low');
    hud.popup(`GRAPHICS: ${qName.toUpperCase()} (AUTO)`, '#8a93a6');
  }
}
const audio = new Audio();
const music = new Music(audio);
let musicOn = true;
try { musicOn = localStorage.getItem('nh.music') !== '0'; } catch { /* ignore */ }
const input = new Input();
const hud = new HUD(track);
const pursuit = new Pursuit(scene, track);

// ---------- game state ----------
const G = {
  phase: 'loading', mode: 'race', laps: 3, trafficOn: true, startAt: 0, slot: 0, grid: {},
  prog: 0, lastDist: 0, completed: 0, lapStart: 0, best: 0, finished: false, finishMs: 0, finishPos: 0,
  stops: [], nextStop: 0, wrongT: 0, camMode: 0, mw: false, lastCount: -1, lastLit: -1, goShown: false, escT: 0,
  lobby: { players: [], host: null, phase: 'lobby' }, results: null, freezeUntil: 0,
  driftT: 0, hitCd: 0, sendT: 0, blur: 0,
};
let me = new CarPhysics(track);
let myVis = null;
const remotes = new Map(); // id -> {vis, color, name, cops:[]}
let name = '', color = PAINTS[0], car = 'ferrari';
try { name = localStorage.getItem('nh.name') || ''; color = localStorage.getItem('nh.color') || color; car = localStorage.getItem('nh.car') || car; } catch { /* storage unavailable */ }
if (!name) name = 'Racer' + Math.floor(Math.random() * 900 + 100);

// ---------- UI ----------
const paints = $('paints');
for (const c of PAINTS) {
  const b = document.createElement('button');
  b.style.background = c; b.dataset.c = c;
  b.onclick = () => { color = c; save(); refreshPaint(); sendHello(); };
  paints.appendChild(b);
}
function refreshPaint() {
  for (const b of paints.children) b.classList.toggle('on', b.dataset.c === color);
  if (myVis) myVis.setColor(color);
}
$('name').value = name;
$('name').addEventListener('input', () => { name = $('name').value.trim() || name; save(); clearTimeout(G.nameT); G.nameT = setTimeout(sendHello, 300); });
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
function save() { try { localStorage.setItem('nh.name', name); localStorage.setItem('nh.color', color); localStorage.setItem('nh.car', car); } catch { /* ignore */ } }
function setCar(id) {
  car = id;
  const c = CARS[car];
  $('carName').textContent = c.name;
  $('carSpec').textContent = c.auto ? `${c.seg} · ${c.top} km/h · 0-${c.vAcc} ${c.tAcc} s` : '';
  $('stSpeed').style.width = c.stats.speed * 100 + '%';
  $('stAccel').style.width = c.stats.accel * 100 + '%';
  $('stHandling').style.width = c.stats.handling * 100 + '%';
  if (!carLoaded(id)) { $('carSpec').textContent += ' · loading…'; ensureCar(id).then(() => { if (car === id) setCar(id); }); return; }
  if (myVis && myVis.carId !== car) { myVis.dispose(); myVis = new CarVisual(car, color, { name }); scene.add(myVis.root); }
}
const cycleCar = (d) => { setCar(CAR_IDS[(CAR_IDS.indexOf(car) + d + CAR_IDS.length) % CAR_IDS.length]); save(); sendHello(); };
$('carPrev').onclick = () => cycleCar(-1);
$('carNext').onclick = () => cycleCar(1);
const isHost = () => net.id && G.lobby.host === net.id;
for (const b of $('modeSeg').children) b.onclick = () => isHost() && net.send({ t: 'cfg', mode: b.dataset.mode });
for (const b of $('lapSeg').children) b.onclick = () => isHost() && net.send({ t: 'cfg', laps: +b.dataset.laps });
for (const b of $('trafficSeg').children) b.onclick = () => isHost() && net.send({ t: 'cfg', traffic: b.dataset.traffic === '1' });
$('startBtn').onclick = () => { audio.start(); net.send({ t: 'start' }); };
$('mapSel').onchange = (e) => isHost() && net.send({ t: 'cfg', map: e.target.value });
$('lobbyBtn').onclick = () => net.send({ t: 'end' });
$('musicBtn').onclick = () => {
  musicOn = !musicOn;
  try { localStorage.setItem('nh.music', musicOn ? '1' : '0'); } catch { /* ignore */ }
  if (!musicOn) music.stop();
};
let lastLyric = '';
function renderLyrics() {
  $('musicBtn').innerHTML = musicOn ? '&#9835; MUSIC ON' : '&#9835; MUSIC OFF';
  if (!audio.ctx) return;
  const l = music.lyrics();
  let html = '', next = '';
  if (!musicOn || !l) html = '<span class="muted">Music off</span>';
  else if (l.line) { html = l.line.map((s, i) => `<span class="${i < l.idx ? 'sung' : ''}">${esc(s)}</span>`).join(''); next = l.next || ''; }
  else { html = '&#9835; &#9835; &#9835;'; next = l.next || ''; }
  const key = html + next;
  if (key !== lastLyric) { lastLyric = key; $('lyLine').innerHTML = html; $('lyNext').textContent = next; }
}
addEventListener('pointerdown', () => audio.start());
addEventListener('keydown', () => audio.start());

function renderLobby() {
  if (!net) return;
  const L = G.lobby, host = isHost();
  const sel = $('mapSel');
  if (sel.options.length !== mapIndex.length) {
    sel.innerHTML = mapIndex.map((m) => `<option value="${m.id}">${esc(m.name)} — ${esc(m.sub)}</option>`).join('');
  }
  sel.value = G.mapId || L.map || 'bengaluru';
  sel.disabled = !host;
  const info = G.mapInfo;
  drawMapPreviews(G.mapId || L.map, host);
  $('mapInfo').textContent = info ? (info.closed ? 'Closed street circuit · lap races' : `${info.start} → ${info.end} · ${(info.length / 1000).toFixed(1)} km of real road`) : '';
  const open = info && !info.closed;
  $('modeSeg').children[0].textContent = open ? 'SPRINT' : 'CIRCUIT RACE';
  $('lobby').innerHTML = L.players.map((p) =>
    `<div class="p"><i class="dot" style="background:${p.color}"></i><span class="${p.id === net.id ? 'me' : ''}">${esc(p.name)}</span><span class="car">${esc(CARS[p.car]?.name || '')}</span>${p.id === L.host ? '<span class="tag">HOST</span>' : ''}</div>`).join('');
  $('lobbyCount').textContent = `${L.players.length} DRIVER${L.players.length === 1 ? '' : 'S'}`;
  for (const b of $('modeSeg').children) { b.classList.toggle('on', b.dataset.mode === L.mode); b.disabled = !host; }
  for (const b of $('lapSeg').children) { b.classList.toggle('on', +b.dataset.laps === L.laps); b.disabled = !host; }
  for (const b of $('trafficSeg').children) { b.classList.toggle('on', (b.dataset.traffic === '1') === L.traffic); b.disabled = !host; }
  $('lapsRow').style.display = L.mode === 'race' && !open ? '' : 'none';
  $('startBtn').style.display = host ? '' : 'none';
  $('waitHost').style.display = host ? 'none' : '';
  $('hostNote').textContent = host ? '(you are host)' : '';
  $('joinHint').textContent = `Friends on your network open ${location.host === 'localhost:8080' || location.hostname === '127.0.0.1' ? 'this machine\'s LAN IP (printed by the server)' : 'http://' + location.host}`;
  $('lobbyBtn').style.display = host ? '' : 'none';
  $('resWait').style.display = host ? 'none' : '';
}

// Route maps: thumbnails of every map plus a larger preview (route, landmarks, elevation) of the selected one.
const POI_COL = { gopuram: '#ffb400', church: '#9fd8ff', mosque: '#7dffb0', station: '#f7c900', heritage: '#ff9a6b', fort: '#ff9a6b', park: '#6bdc6b', stadium: '#c9c9ff' };
function routeOf(m) {
  if (m.route) return m.route;
  if (!m.closed) return null;
  const t = m.id === G.mapId ? track : (routeOf.tokyo ||= new Track(null));
  const out = [];
  for (let i = 0; i < t.n; i += Math.max(1, Math.floor(t.n / 160))) out.push([t.px[i], t.pz[i], t.py[i]]);
  out.push(out[0]);
  return out;
}
function drawRoute(cv, m, big) {
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, r = routeOf(m);
  x.clearRect(0, 0, W, H);
  if (!r) return;
  const prof = big && !m.closed ? 64 : 0, pad = big ? 18 : 6;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [a, b] of r) { x0 = Math.min(x0, a); x1 = Math.max(x1, a); z0 = Math.min(z0, b); z1 = Math.max(z1, b); }
  const k = Math.min((W - pad * 2) / (x1 - x0 || 1), (H - prof - pad * 2) / (z1 - z0 || 1));
  const ox = (W - (x1 - x0) * k) / 2, oz = (H - prof - (z1 - z0) * k) / 2;
  const P = (a, b) => [ox + (a - x0) * k, oz + (b - z0) * k];
  const yMin = Math.min(...r.map((q) => q[2])), yMax = Math.max(...r.map((q) => q[2]));
  x.lineCap = x.lineJoin = 'round';
  x.strokeStyle = 'rgba(57,230,255,0.25)'; x.lineWidth = big ? 9 : 5;
  x.beginPath(); r.forEach((q, i) => x[i ? 'lineTo' : 'moveTo'](...P(q[0], q[1]))); x.stroke();
  x.lineWidth = big ? 3 : 2;
  for (let i = 1; i < r.length; i++) {
    const h = (r[i][2] - yMin) / (yMax - yMin || 1);
    x.strokeStyle = `hsl(${190 - h * 160},100%,${60 + h * 10}%)`;
    x.beginPath(); x.moveTo(...P(r[i - 1][0], r[i - 1][1])); x.lineTo(...P(r[i][0], r[i][1])); x.stroke();
  }
  const dot = (q, c, rad) => { x.fillStyle = c; x.beginPath(); x.arc(...P(q[0], q[1]), rad, 0, 7); x.fill(); };
  dot(r[0], '#7cff6b', big ? 6 : 3);
  if (!m.closed) dot(r[r.length - 1], '#ff2e88', big ? 6 : 3);
  if (!big) return;
  x.font = '700 13px Arial'; x.textBaseline = 'middle';
  for (const p of m.pois || []) {
    const [px, pz] = P(p.x, p.z);
    x.fillStyle = POI_COL[p.type] || '#ffffff'; x.beginPath(); x.arc(px, pz, 4, 0, 7); x.fill();
    x.fillStyle = 'rgba(230,236,255,0.85)'; x.textAlign = px > W * 0.6 ? 'right' : 'left';
    x.fillText(p.name.length > 26 ? p.name.slice(0, 25) + '…' : p.name, px + (px > W * 0.6 ? -8 : 8), pz);
  }
  x.textAlign = 'left'; x.font = '800 13px Arial';
  x.fillStyle = '#7cff6b'; x.fillText('● ' + m.start, 10, 14);
  if (!m.closed) { x.fillStyle = '#ff2e88'; x.textAlign = 'right'; x.fillText(m.end + ' ●', W - 10, 14); }
  if (!prof) return;
  const top = H - prof + 8, ph = prof - 22;
  x.fillStyle = 'rgba(57,230,255,0.12)'; x.strokeStyle = '#39e6ff'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(0, H - 14);
  r.forEach((q, i) => x.lineTo(i / (r.length - 1) * W, top + ph - (q[2] - yMin) / (yMax - yMin || 1) * ph));
  x.lineTo(W, H - 14); x.closePath(); x.fill(); x.stroke();
  x.fillStyle = '#aab3c4'; x.font = '700 12px Arial'; x.textAlign = 'left';
  x.fillText(`ELEVATION · ${Math.round(yMax - yMin)} m climb · ${(m.length / 1000).toFixed(1)} km`, 8, H - 5);
}
let thumbsFor = '';
function drawMapPreviews(id, host) {
  const box = $('mapThumbs');
  if (box.childElementCount !== mapIndex.length) {
    box.innerHTML = '';
    for (const m of mapIndex) {
      const c = document.createElement('canvas'); c.width = 120; c.height = 90; c.title = `${m.name} — ${m.sub}`; c.dataset.id = m.id;
      c.onclick = () => isHost() && net.send({ t: 'cfg', map: m.id });
      box.appendChild(c); drawRoute(c, m, false);
    }
  }
  box.classList.toggle('locked', !host);
  for (const c of box.children) c.classList.toggle('on', c.dataset.id === id);
  if (thumbsFor === id + G.mapId) return;
  thumbsFor = id + G.mapId;
  const m = mapIndex.find((q) => q.id === id);
  if (m) drawRoute($('mapPreview'), m, true);
}

// ---------- networking ----------
let net = null;
const netHandlers = {
  welcome: () => sendHello(),
  lobby: (m) => {
    G.lobby = m;
    if (m.map && m.map !== G.mapId && G.phase === 'menu') queueMap(m.map);
    renderLobby();
    syncRemoteVisuals();
    if (m.phase === 'lobby' && (G.phase === 'race' || G.phase === 'results')) toMenu();
  },
  start: (m) => { queueMap(m.map || G.mapId).then(() => startEvent(m)); },
  fin: (m) => { if (m.id !== net.id) { const p = G.lobby.players.find((x) => x.id === m.id); if (p) hud.popup(`${esc(p.name)} FINISHED`, '#ffb400'); } },
  result: (m) => showResults(m),
  knock: (m) => traffic?.applyRemoteKnock(m.k.gi, m.k),
  close: () => hud.net('reconnecting…'),
  chat: (m) => appendChat(m),
};
function sendHello() { net.send({ t: 'hello', name, color, car }); }

function syncRemoteVisuals() {
  if (!myVis) return;
  const ids = new Set(G.lobby.players.map((p) => p.id));
  for (const [id, r] of remotes) if (!ids.has(id)) { r.vis.dispose(); for (const c of r.cops) c.dispose(); remotes.delete(id); }
  for (const p of G.lobby.players) {
    if (p.id === net.id) continue;
    let r = remotes.get(p.id);
    if (r && (r.color !== p.color || r.name !== p.name || r.car !== p.car)) { r.vis?.dispose(); r.vis = null; }
    if (!r) { r = { cops: [], st: {} }; remotes.set(p.id, r); }
    if (!r.vis) {
      // until their car has downloaded, show a stand-in and rebuild once it arrives
      const ready = carLoaded(p.car) || !CARS[p.car];
      if (!ready) ensureCar(p.car).then(syncRemoteVisuals);
      r.vis = new CarVisual(p.car, p.color, { name: p.name }); r.color = p.color; r.name = p.name; r.car = ready ? p.car : null; scene.add(r.vis.root);
    }
  }
}

// ---------- maps ----------
const TOKYO_INFO = { id: 'tokyo', name: 'NEON HARBOR', sub: 'Tokyo street circuit', start: 'START', end: 'FINISH', length: 0, closed: true };
function queueMap(id) {
  G.mapLoad = (G.mapLoad || Promise.resolve()).then(() => loadMap(id)).catch((e) => console.error('map load failed', e));
  return G.mapLoad;
}
function disposeCity() {
  if (!city) return;
  city.removeFromParent();
  city.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const k of ['map', 'roughnessMap', 'emissiveMap']) m[k]?.dispose?.();
      m.uniforms?.map?.value?.dispose?.();
      m.dispose();
    }
  });
  city = null;
}
async function loadMap(id) {
  if (G.mapId === id) return;
  if (!THEMES[id]) id = 'tokyo';
  const data = id === 'tokyo' ? null : (mapCache[id] ||= await (await fetch(`maps/${id}.json`)).json());
  const base = THEMES[id];
  const T = { ...base, banner: data ? data.start : base.banner, endLabel: data ? data.end : 'FINISH', terrain: data?.terrain, pois: data?.pois };
  $('loadtext').textContent = 'Building ' + (data ? data.name : 'Neon Harbor circuit') + '…';
  disposeCity();
  setRoadWidth(data?.roadHalfWidth || 9);
  track = new Track(data ? { ...data, overpasses: T.overpasses } : null);
  const plans = planLandmarks(track, T);
  const poiPlans = planPois(track, T, plans);
  T.reserved = plans.concat(poiPlans);
  city = new THREE.Group();
  scene.add(city);
  world = buildWorld(city, track, renderer, T);
  props = T.tokyo ? buildTokyo(city, track, world) : buildIndia(city, track, world, T, plans);
  props.setWet(rain.visible);
  buildPois(city, track, T, poiPlans, world.groundY);
  traffic = new Traffic(city, track, trafficModels, T, id, world.groundY);
  traffic.drawDist = Q.traffic;
  chunkStatic(city, new Set(traffic.meshes)); // route-long static meshes -> 400 m tiles the camera can cull
  traffic.onKnock = (gi, k, imp) => {
    net?.send({ t: 'knock', k: { gi, x: k.x, y: k.y, z: k.z, vx: k.vx, vy: k.vy, vz: k.vz, yaw: k.yaw, pitch: 0, roll: 0, wy: k.wy, wp: k.wp, wr: k.wr } });
    if (imp > 6) hud.popup(imp > 14 ? 'WRECKED!' : 'TAKEDOWN', '#ffb400');
  };
  hud.setTrack(track);
  // checkpoints along sprint routes: real bus stops (and landmarks / numbered ghat hairpins where stops are sparse)
  G.stops = (data?.stops || []).map((q) => ({ name: q.name, x: q.x, z: q.z, d: track.nearest(q.x, q.z).dist }))
    .filter((q) => q.d > track.startDist + 60 && q.d < track.finishDist - 60).sort((a, b) => a.d - b.d);
  hud.setStops(G.stops, data?.end || '');
  pursuit.track = track;
  pursuit.reset();
  applySky(sky, scene, T.sky);
  const oldEnv = scene.environment;
  scene.environment = buildEnvironment(renderer, T.sky);
  oldEnv?.dispose();
  me = new CarPhysics(track);
  G.mapId = id; G.theme = T; G.mapInfo = data || TOKYO_INFO;
  // upload every texture now so the first sight of a vehicle or building type mid-race doesn't hitch
  scene.traverse((o) => { for (const m of [].concat(o.material || [])) for (const k in m) if (m[k]?.isTexture) renderer.initTexture(m[k]); });
  // ...and compile every shader now, including traffic types not yet on screen and the police car (kept hidden so its
  // programs stay cached), so nothing compiles mid-race.
  if (!policeWarm) { policeWarm = new CarVisual(POLICE_CAR, 0x08090c, { police: true, beam: false }); scene.add(policeWarm.root); }
  const hidden = traffic.meshes.filter((m) => !m.visible);
  for (const m of hidden) m.visible = true;
  policeWarm.root.visible = true;
  renderer.compile(scene, camera);
  for (const m of hidden) m.visible = false;
  policeWarm.root.visible = false;
  loadNearTraffic(traffic);
  renderLobby();
}

// Close-up detail: in the background, traffic types that also exist as player vehicles get that full-detail model
// (more triangles, 1024 px compressed textures) for vehicles within ~45 m. Shaders compile as each arrives, so
// nothing compiles on first sight.
async function loadNearTraffic(tr) {
  for (const ty of tr.types) {
    const id = ty.type.startsWith('real:') && ty.type.slice(5);
    if (!id || !VEHICLE_CREDITS[id]) continue;
    const m = await loadNearModel(id);
    if (traffic !== tr) return; // map changed meanwhile
    if (!m) continue;
    const meshes = tr.attachNear(ty.type, m);
    for (const im of meshes) im.visible = true;
    renderer.compile(scene, camera);
    for (const im of meshes) im.visible = false;
  }
}

// ---------- flow ----------
function toMenu() {
  G.phase = 'menu';
  $('menu').classList.remove('hidden'); $('results').classList.add('hidden');
  hud.show(false); $('big').innerHTML = '';
  pursuit.reset(); pursuit.clear();
  me.frozen = true;
  world.setStartLights(0, false);
}

function startEvent(m) {
  G.phase = 'race'; G.mode = m.mode; G.laps = m.laps; G.trafficOn = m.traffic; G.startAt = m.startAt; G.grid = m.grid; G.nextStop = 0;
  G.slot = m.grid[net.id] ?? 0;
  const g = gridSlot(track, G.slot);
  me = new CarPhysics(track, vehicleOpts(car));
  me.voice = CARS[car].voice || 1;
  me.x = g.x; me.z = g.z; me.yaw = g.yaw; me.updateTrack();
  me.frozen = true;
  G.lastDist = me.dist; G.prog = track.delta(me.dist, track.startDist);
  G.completed = 0; G.lapStart = m.startAt; G.best = 0; G.finished = false; G.finishMs = 0;
  G.lastCount = -1; G.lastLit = -1; G.goShown = false; G.wrongT = 0; G.freezeUntil = 0;
  cam.yaw = me.yaw;
  pursuit.reset();
  traffic.setEnabled(m.traffic);
  G.finishT = 0;
  music.stop();
  $('menu').classList.add('hidden'); $('results').classList.add('hidden');
  hud.show(true); hud.setMode(m.mode);
  audio.start();
}

function showResults(m) {
  G.phase = 'results';
  const rows = m.order.map((o, i) => {
    const val = m.mode === 'race' ? (o.time ? fmt(o.time / 1000) : 'DNF') : (o.bounty || 0).toLocaleString();
    return `<tr><td>${i + 1}</td><td><i style="background:${o.color}"></i>${esc(o.name)}</td><td>${val}</td></tr>`;
  });
  $('resTable').innerHTML = rows.join('');
  $('results').classList.remove('hidden');
  renderLobby();
}

// ---------- camera ----------
const cam = { yaw: 0, fov: 62, shake: 0 };
const CAMS = [{ back: 6.4, up: 2.05, look: 0.95 }, { back: 4.4, up: 1.5, look: 0.9 }, { hood: true }, { bumper: true }];
function updateCamera(dt, t) {
  const lb = input.lookBack();
  const m = CAMS[G.camMode];
  if (m.back) {
    cam.yaw += wrapAngle(me.yaw - cam.yaw) * (1 - Math.exp(-dt * 6.5));
    const yaw = cam.yaw + (lb ? Math.PI : 0);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const back = m.back + Math.min(me.speed, 100) * 0.018;
    const cx = me.x - fx * back, cz = me.z - fz * back;
    const cy = Math.max(me.y + m.up + Math.min(me.speed, 100) * 0.003, (world?.groundY?.(cx, cz) ?? -1e9) + 1.2);
    camera.position.set(cx, cy, cz);
    camera.lookAt(me.x + fx * 5, me.y + m.look, me.z + fz * 5);
  } else {
    const yaw = me.yaw + (lb ? Math.PI : 0), fx = Math.sin(me.yaw), fz = Math.cos(me.yaw);
    const off = m.hood ? (lb ? -1.6 : 0.1) : (lb ? -2.4 : 2.35), y = m.hood ? 1.18 : 0.55;
    camera.position.set(me.x + fx * off, me.y + y, me.z + fz * off);
    camera.lookAt(camera.position.x + Math.sin(yaw) * 20, me.y + y - 0.4 + Math.tan(me.pitch) * 20, camera.position.z + Math.cos(yaw) * 20);
  }
  const shakeT = me.nitroOn ? 0.035 + me.speed * 0.0004 : me.scraping ? 0.03 : 0;
  cam.shake = Math.max(cam.shake * Math.exp(-dt * 6), shakeT);
  if (cam.shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * cam.shake;
    camera.position.y += (Math.random() - 0.5) * cam.shake;
  }
  const fovT = 60 + Math.min(me.speed, 105) * 0.17 + (me.nitroOn ? 10 : 0);
  cam.fov += (fovT - cam.fov) * (1 - Math.exp(-dt * 3));
  camera.fov = cam.fov; camera.updateProjectionMatrix();
}

function menuCamera(t) {
  const s = gridSlot(track, myLobbyIndex());
  const a = t * 0.12;
  const r = 8.5 + Math.sin(t * 0.21) * 1.5;
  camera.position.set(s.x + Math.cos(a) * r, s.y + 1.4 + Math.sin(t * 0.33) * 0.5, s.z + Math.sin(a) * r);
  camera.lookAt(s.x, s.y + 0.6, s.z);
  camera.fov = 50; camera.updateProjectionMatrix();
}
const myLobbyIndex = () => Math.max(0, G.lobby.players.findIndex((p) => p.id === net.id));

// ---------- effects helpers ----------
function emitSmoke(x, z, yaw, amount, vx = 0, vz = 0, y = me.y) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  for (const side of [-1, 1]) {
    if (Math.random() > amount) continue;
    const px = x - fx * 1.5 + fz * 0.85 * side, pz = z - fz * 1.5 - fx * 0.85 * side;
    smoke.emit(px, y + 0.35, pz, vx * 0.15 + (Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 0.6, vz * 0.15 + (Math.random() - 0.5) * 1.5, 2.2 + Math.random(), 1.0, 3.4, 0.2, -0.15, 1.2);
  }
}
function skid(key, x, z, yaw, on, strength, y = me.y) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  for (const side of [-1, 1]) {
    const k = key + side;
    if (!on) { skids.stop(k); continue; }
    skids.add(k, x - fx * 1.5 + fz * 0.82 * side, z - fz * 1.5 - fx * 0.82 * side, fx, fz, strength, y);
  }
}
function burst(x, z, n, speed, y = me.y) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
    sparks.emit(x, y + 0.4 + Math.random() * 0.4, z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 0.4 + Math.random() * 0.4, 0.12, 0, 1, 9.8, 0.5);
  }
}

// ---------- race update ----------
const tmpBody = { yawRate: 0, half: 2.25, r: 1.05 };
function physicsStep(dt, inp, st) {
  const frozen = st < G.startAt || performance.now() < G.freezeUntil;
  me.frozen = frozen;
  me.step(dt, inp);
  if (frozen || G.finished) return;
  if (traffic.enabled) {
    const hit = traffic.collideBody(me, vehicleMass(car), 0.2);
    if (hit.impact > 2.5) { onHit(hit.impact, (me.x + hit.car.x) / 2, (me.z + hit.car.z) / 2); hit.car.hitAt = st; }
    for (const tc of traffic.cars) if (!tc.knocked) nearMiss(tc, st);
  }
  // other players
  for (const [, r] of remotes) {
    if (!r.live || r.st.f) continue;
    Object.assign(tmpBody, { x: r.st.x, z: r.st.z, yaw: r.st.y, vx: r.st.vx, vz: r.st.vz });
    const imp = collide(me, tmpBody, 1, 0, 0.3);
    if (imp > 2) onHit(imp, (me.x + tmpBody.x) / 2, (me.z + tmpBody.z) / 2);
  }
  if (me.wallImpact > 4) onHit(me.wallImpact, me.x + me.tz * Math.sign(me.lateral), me.z - me.tx * Math.sign(me.lateral));
}

function onHit(imp, x, z) {
  burst(x, z, Math.min(40, imp * 2), Math.min(12, imp * 0.5));
  cam.shake = Math.max(cam.shake, Math.min(0.5, imp * 0.02));
  if (G.hitCd <= 0) { audio.hit(imp); G.hitCd = 0.15; }
}

function nearMiss(tc, st) {
  const tfx = Math.sin(tc.yaw), tfz = Math.cos(tc.yaw);
  const rx = me.x - tc.x, rz = me.z - tc.z;
  const along = rx * tfx + rz * tfz, side = rx * tfz - rz * tfx;
  const close = Math.abs(along) < tc.half + 2.5 && Math.abs(side) < 3.6;
  if (close) tc.near = true;
  else if (tc.near) {
    tc.near = false;
    const rel = Math.hypot(me.vx - tc.vx, me.vz - tc.vz);
    if (rel > 14 && !(tc.hitAt && st - tc.hitAt < 1500)) {
      me.nitro = Math.min(1, me.nitro + 0.12);
      if (G.mode === 'pursuit' && pursuit.state === 'pursuit') pursuit.bounty += 150;
      hud.popup('NEAR MISS', '#39e6ff', '+NOS');
      audio.whoosh();
    }
  }
}

function updateRace(dt, inp, st, t) {
  const L = track.length;
  G.hitCd -= dt;
  // Even substeps per rendered frame (>=120Hz) so motion stays smooth on any refresh rate.
  const steps = Math.min(8, Math.max(1, Math.ceil(dt / STEP - 1e-6)));
  const h = dt / steps;
  const events = [];
  for (let i = 0; i < steps; i++) {
    physicsStep(h, inp, st);
    if (G.mode === 'pursuit' && st >= G.startAt) pursuit.update(h, me, inp, events, traffic, { smoke });
  }
  for (const e of events) pursuitEvent(e, st);

  // progress / laps
  G.prog += track.delta(me.dist, G.lastDist);
  while (G.stops.length && G.nextStop < G.stops.length && me.dist >= G.stops[G.nextStop].d && st >= G.startAt) {
    const q = G.stops[G.nextStop++];
    hud.popup(`📍 ${esc(q.name.toUpperCase())}`, '#ffb400', `CHECKPOINT ${G.nextStop}/${G.stops.length} · ${fmt((st - G.startAt) / 1000)}`);
  }
  G.lastDist = me.dist;
  const finishRace = () => {
    G.finished = true; G.finishMs = st - G.startAt;
    net.send({ t: 'fin', time: G.finishMs });
    const pos = standings().findIndex((o) => o.me) + 1;
    hud.big(`${ordinal(pos)}<span class="sub">FINISHED · ${fmt(G.finishMs / 1000)}</span>`, pos === 1 ? '#ffb400' : '#fff', 4);
  };
  if (G.mode === 'race' && !G.finished && st >= G.startAt && !track.closed) {
    if (me.dist >= track.finishDist) finishRace();
  } else if (G.mode === 'race' && !G.finished && st >= G.startAt) {
    const done = Math.max(0, Math.floor(G.prog / L));
    if (done > G.completed) {
      const lapT = (st - G.lapStart) / 1000;
      G.completed = done; G.lapStart = st;
      if (!G.best || lapT < G.best) G.best = lapT;
      if (done >= G.laps) finishRace();
      else {
        hud.popup(done === G.laps - 1 ? 'FINAL LAP' : `LAP ${done + 1}`, '#ffb400', fmt(lapT));
      }
    }
  }

  // wrong way
  const along = me.vx * me.tx + me.vz * me.tz;
  G.wrongT = along < -4 ? G.wrongT + dt : 0;
  hud.wrongWay(G.wrongT > 1);

  // drift / smoke / skids / sparks
  const sliding = (me.slip > 0.2 && me.speed > 8) || (me.handbrake && me.speed > 6);
  const braking = me.brake > 0.5 && me.fwd > 15;
  const burnout = !me.frozen && me.throttle > 0.5 && me.fwd < 7 && me.fwd > -1;
  if (sliding || burnout) emitSmoke(me.x, me.z, me.yaw, burnout ? 0.2 : 0.8, me.vx, me.vz);
  skid('me', me.x, me.z, me.yaw, sliding || braking, sliding ? 0.55 : 0.35);
  if (me.scraping && me.speed > 6) {
    const s = Math.sign(me.lateral);
    for (let i = 0; i < 3; i++) {
      const o = (Math.random() - 0.5) * 3.6, fx = Math.sin(me.yaw), fz = Math.cos(me.yaw);
      sparks.emit(me.x + me.tz * s * 1.0 + fx * o, me.y + 0.35, me.z - me.tx * s * 1.0 + fz * o,
        -me.vx * 0.3 + (Math.random() - 0.5) * 4, 1 + Math.random() * 3, -me.vz * 0.3 + (Math.random() - 0.5) * 4, 0.35, 0.1, 0, 1, 9.8, 0.3);
    }
  }
  if (me.drifting) G.driftT += dt;
  else { if (G.driftT > 1.4) hud.popup('DRIFT', '#ff2e88', `${G.driftT.toFixed(1)}s +NOS`); G.driftT = 0; }
  if (me.nitroOn && !G.wasNitro) audio.whoosh();
  G.wasNitro = me.nitroOn;

  // countdown + start lights
  const rem = (G.startAt - st) / 1000;
  if (rem > 0) {
    const lit = clamp(Math.floor((4.5 - rem) / 0.8), 0, 5);
    if (lit !== G.lastLit) { G.lastLit = lit; world.setStartLights(lit, false); if (lit > 0) audio.beep(440); }
    const n = Math.ceil(rem);
    if (n <= 3 && n !== G.lastCount) { G.lastCount = n; hud.big(String(n), '#fff', 0.9); }
  } else if (!G.goShown) {
    G.goShown = true; world.setStartLights(5, true); audio.beep(880, 0.5);
    hud.big('GO!', '#2ee87a', 1.0);
    if (G.mode === 'pursuit') hud.popup('LOSE THE COPS · BANK THE BOUNTY', '#ffb400');
  } else if (rem < -3 && G.lastLit !== -2) { G.lastLit = -2; world.setStartLights(0, false); }

  // send state
  G.sendT -= dt;
  if (G.sendT <= 0) {
    G.sendT = 0.05;
    const r2 = (v) => Math.round(v * 100) / 100;
    const s = { x: r2(me.x), z: r2(me.z), y: r2(me.yaw), h: r2(me.y), pp: r2(me.pitch), vx: r2(me.vx), vz: r2(me.vz), st: r2(me.steer), n: me.nitroOn ? 1 : 0,
      br: me.brake > 0.3 ? 1 : 0, d: me.drifting || (me.handbrake && me.speed > 6) ? 1 : 0, p: Math.round(G.prog), f: G.finishMs };
    if (G.mode === 'pursuit') { s.b = pursuit.banked + Math.floor(pursuit.bounty); s.h = pursuit.heat; s.c = pursuit.snapshot(); }
    net.send({ t: 's', s });
  }

  // HUD
  if (G.mode === 'race') {
    const order = standings();
    const myIdx = order.findIndex((o) => o.me);
    hud.race({ pos: myIdx + 1, total: order.length, lap: G.completed + 1, laps: G.laps, remain: track.closed ? null : Math.max(0, track.finishDist - me.dist), dest: G.mapInfo?.end,
      lapTime: G.finished ? 0 : Math.max(0, (st - G.lapStart) / 1000), best: G.best, order });
  } else {
    hud.pursuit({ heat: pursuit.heat, bounty: pursuit.bounty, banked: pursuit.banked, cops: pursuit.cops, state: pursuit.state,
      bust: pursuit.bust, cool: pursuit.cool, nearest: pursuit.nearest ?? Infinity });
  }
}

function standings() {
  const L = track.length;
  const list = [{ me: true, name, color, prog: G.prog, f: G.finishMs }];
  for (const p of G.lobby.players) {
    if (p.id === net.id) continue;
    const r = remotes.get(p.id);
    list.push({ me: false, name: p.name, color: p.color, prog: r?.st?.p ?? -100, f: r?.st?.f || 0 });
  }
  list.sort((a, b) => (a.f && b.f ? a.f - b.f : a.f ? -1 : b.f ? 1 : b.prog - a.prog));
  const lead = list[0];
  return list.map((o) => ({ ...o, done: o.f, gap: o === lead ? (track.closed ? `L${Math.min(G.laps, Math.max(1, Math.floor(o.prog / L) + 1))}` : 'LEAD') : `-${Math.max(0, Math.round(lead.prog - o.prog))}m` }));
}

function pursuitEvent(e, st) {
  switch (e.type) {
    case 'pursuit': hud.big('PURSUIT', '#ff3030', 1.4); break;
    case 'heat': hud.popup(`HEAT LEVEL ${e.heat}`, '#ffb400'); break;
    case 'roadblock': hud.popup('ROADBLOCK AHEAD', '#ff3030'); break;
    case 'hit': onHit(e.impact, (me.x + e.x) / 2, (me.z + e.z) / 2); break;
    case 'takedown': hud.popup('COP TAKEDOWN', '#ff2e88', `+${(1000 * pursuit.heat).toLocaleString()}`); me.nitro = Math.min(1, me.nitro + 0.3); burst(e.x, e.z, 40, 10); break;
    case 'busted':
      hud.big(`BUSTED<span class="sub">BOUNTY LOST · ${e.lost.toLocaleString()}</span>`, '#ff3030', 3.5);
      G.freezeUntil = performance.now() + 3000; me.vx = me.vz = 0;
      break;
    case 'evaded': hud.big(`EVADED<span class="sub">+${e.bounty.toLocaleString()} BANKED</span>`, '#2ee87a', 3.5); break;
  }
}

// ---------- remotes ----------
const tmpS = {};
function updateRemotes(dt, st, t) {
  const rt = st - 100;
  for (const [id, r] of remotes) {
    if (!r.vis) continue;
    const nr = net.remotes.get(id);
    const s = nr ? net.sampleRemote(id, rt, tmpS) : null;
    r.live = G.phase !== 'menu' && !!s && performance.now() - nr.recv < 2500;
    if (G.phase !== 'menu' && s) {
      r.st = { ...s };
      const fwd = s.vx * Math.sin(s.y) + s.vz * Math.cos(s.y);
      r.vis.update(dt, { x: s.x, z: s.z, y: s.h || 0, pitch: s.pp || 0, yaw: s.y, fwd, steer: s.st, braking: s.br, nitro: s.n }, t);
      if (r.live && s.d) emitSmoke(s.x, s.z, s.y, 0.8, s.vx, s.vz, s.h || 0);
      skid('r' + id, s.x, s.z, s.y, r.live && !!s.d, 0.5, s.h || 0);
      syncRemoteCops(r, s.c || [], dt, t);
    } else {
      const idx = G.phase === 'menu' ? G.lobby.players.findIndex((p) => p.id === id) : (G.grid[id] ?? 0);
      const g = gridSlot(track, Math.max(0, idx));
      r.vis.update(dt, { x: g.x, z: g.z, y: g.y, yaw: g.yaw, fwd: 0, steer: 0 }, t);
      syncRemoteCops(r, [], dt, t);
    }
  }
}
function syncRemoteCops(r, arr, dt, t) {
  while (r.cops.length < arr.length) { const v = new CarVisual(POLICE_CAR, 0x08090c, { police: true, beam: false }); scene.add(v.root); r.cops.push(v); }
  while (r.cops.length > arr.length) r.cops.pop().dispose();
  arr.forEach((c, i) => { r.cops[i].lightsOn = !c[3]; r.cops[i].update(dt, { x: c[0], z: c[1], y: c[4] || 0, yaw: c[2], fwd: 30 }, t); });
}

// ---------- lights ----------
const lampTmp = [];
function updateLights(t) {
  const px = G.phase === 'race' ? me.x : camera.position.x, pz = G.phase === 'race' ? me.z : camera.position.z;
  if (t - (G.lampT || 0) > 0.125 || !lampTmp.length) {
    G.lampT = t;
    lampTmp.length = 0;
    for (const l of world.lamps) lampTmp.push([(l.x - px) ** 2 + (l.z - pz) ** 2, l]);
    lampTmp.sort((a, b) => a[0] - b[0]);
  }
  lampLights.forEach((L, i) => {
    const e = lampTmp[i];
    if (!e) { L.intensity = 0; return; }
    const l = e[1];
    L.position.set(l.x, l.y - 0.4, l.z);
    L.color.set(l.color);
    L.intensity = l.tunnel ? 30 : 55;
  });
  const cops = [];
  for (const c of pursuit.cops) if (!c.dead) cops.push([c.ph.x, c.ph.z, c.ph.y]);
  for (const [, r] of remotes) for (const v of r.cops) if (v.lightsOn) cops.push([v.root.position.x, v.root.position.z, v.root.position.y]);
  cops.sort((a, b) => ((a[0] - px) ** 2 + (a[1] - pz) ** 2) - ((b[0] - px) ** 2 + (b[1] - pz) ** 2));
  const phase = Math.floor(t * 8) % 4;
  copLights.forEach((L, i) => {
    const c = cops[i];
    if (!c) { L.intensity = 0; return; }
    const red = (phase < 2) !== (i % 2 === 1);
    L.color.setHex(red ? 0xff1010 : 0x1040ff);
    L.position.set(c[0], c[2] + 2.2, c[1]);
    L.intensity = 60;
  });
  const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw);
  for (const h of heads) {
    h.intensity = 240;
    h.position.set(me.x + fx * 2.1, me.y + 0.7, me.z + fz * 2.1);
    h.target.position.set(me.x + fx * 30, me.y + Math.tan(me.pitch) * 30, me.z + fz * 30);
  }
}

// After the finish line the player loses control: the car eases into the right lane and parks.
const pilot = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
function finishPilot(dt) {
  G.finishT = (G.finishT || 0) + dt;
  const ahead = track.sample(me.dist + 12 + me.speed * 0.5, -7.2);
  const err = wrapAngle(Math.atan2(ahead.x - me.x, ahead.z - me.z) - me.yaw);
  pilot.steer = clamp(-err * 2, -1, 1);
  const target = G.finishT < 4 ? 14 : 0;
  pilot.throttle = me.fwd < target - 2 ? 0.4 : 0;
  pilot.brake = me.fwd > target + 2 ? (G.finishT < 4 ? 0.35 : 0.8) : 0;
  return pilot;
}

// ---------- keys ----------
function handleKeys() {
  if (input.pressed('KeyM')) { audio.setMuted(!audio.muted); hud.popup(audio.muted ? 'MUTED' : 'SOUND ON', '#8a93a6'); }
  if (input.pressed('KeyH')) audio.honk();
  if (input.pressed('KeyK')) { rain.visible = !rain.visible; props.setWet(rain.visible); hud.popup(rain.visible ? 'RAIN' : 'CLEAR SKIES', '#39e6ff'); }
  if (input.pressed('KeyG')) { G.mw = !G.mw; hud.popup(G.mw ? '"MOST WANTED" FILTER' : 'NEON NIGHT', '#ffb400'); }
  if (G.phase !== 'race' && G.phase !== 'results') return;
  if (input.pressed('KeyC')) G.camMode = (G.camMode + 1) % CAMS.length;
  if (input.pressed('KeyR') && !me.frozen && !G.finished) {
    me.place(me.dist, clamp(me.lateral, -5, 5), 0);
    cam.yaw = me.yaw;
    hud.popup('RESET', '#8a93a6');
  }
  if (input.pressed('Escape')) {
    if (!isHost()) hud.popup('ONLY THE HOST CAN END THE EVENT', '#8a93a6');
    else if (performance.now() - G.escT < 2500) net.send({ t: 'end' });
    else { G.escT = performance.now(); hud.popup('PRESS ESC AGAIN TO END EVENT', '#ffb400'); }
  }
}

// ---------- loop ----------
let last = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (G.phase === 'loading') return;
  const st = net.now(), t = now / 1000;
  const inp = input.update(dt);
  handleKeys();
  hud.tick(dt);

  if (G.phase === 'race' || G.phase === 'results') {
    updateRace(dt, G.finished ? finishPilot(dt) : inp, st, t);
    updateCamera(dt, t);
  } else {
    const g = gridSlot(track, myLobbyIndex());
    me.x = g.x; me.z = g.z; me.y = g.y; me.pitch = 0; me.yaw = g.yaw; me.vx = me.vz = 0; me.fwd = 0; me.speed = 0;
    menuCamera(t);
    if (audio.ctx && musicOn && !music.on) music.start();
    renderLyrics();
  }
  const wheelieT = me.bike && inp.wheelie && me.throttle > 0.3 && me.fwd > 2 && me.fwd < 85 ? 0.55 : 0;
  me.wheelie = (me.wheelie || 0) + (wheelieT - (me.wheelie || 0)) * Math.min(1, dt * 3.5);
  myVis.update(dt, { x: me.x, z: me.z, y: me.y, pitch: me.pitch, yaw: me.yaw, fwd: me.fwd, steer: me.steer, lean: me.bike ? me.lean : undefined, wheelie: me.wheelie, braking: me.brake > 0.3 || (me.fwd < 0.5 && G.phase === 'race'), nitro: me.nitroOn }, t);
  myVis.tag.visible = false;
  updateRemotes(dt, st, t);

  const tt = G.phase === 'menu' ? st / 1000 : (st - G.startAt) / 1000;
  traffic?.update(tt, dt, camera.position.x, camera.position.z);
  world.update(t);
  props.update?.(t);
  const pscale = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  smoke.update(dt, pscale); sparks.update(dt, pscale); skids.flush();
  rain.update(dt, camera.position, G.phase === 'menu' ? 0 : me.vx, G.phase === 'menu' ? 0 : me.vz);
  updateLights(t);

  G.hudT = (G.hudT || 0) - dt;
  const drawHud = G.hudT <= 0;
  if (drawHud) G.hudT = 1 / 30;
  if ((G.phase === 'race' || G.phase === 'results') && drawHud) {
    hud.drawTach(me);
    const others = [];
    const otherCops = [];
    for (const p of G.lobby.players) {
      const r = remotes.get(p.id);
      if (r?.live) { others.push({ x: r.st.x, z: r.st.z, color: p.color }); for (const v of r.cops) otherCops.push([v.root.position.x, v.root.position.z]); }
    }
    hud.drawMinimap(me, others, pursuit.cops, otherCops, t);
    if (G.stops.length) hud.drawStops(me, G.nextStop, t);
    let vis = 0; for (const [, r] of remotes) if (r.live) vis++;
    hud.net(`${Math.round(net.rtt || 0)} ms · ${perf.fps} fps · ${qName} · ${G.lobby.players.length} driver${G.lobby.players.length === 1 ? '' : 's'} · ${vis} visible`);
  }
  if (G.phase === 'race' || G.phase === 'results') {
    let siren = 0;
    if (pursuit.nearest < 400) siren = 1 - pursuit.nearest / 400;
    audio.update(me, siren, G.phase === 'race');
  } else {
    audio.update(me, 0, false);
  }

  const blurT = me.nitroOn ? 1 : Math.max(0, (me.speed - 55) / 45) * 0.45;
  G.blur += (blurT - G.blur) * (1 - Math.exp(-dt * 4));
  grade.uniforms.blur.value = G.phase === 'menu' || !Q.blur ? 0 : G.blur;
  grade.uniforms.time.value = t % 100;
  grade.uniforms.mw.value = G.mw ? 1 : 0;
  grade.uniforms.aspect.value = innerWidth / innerHeight;
  composer.render(dt);
  trackPerf(dt);
}

function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', onResize);

function ordinal(n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'); }

// ---------- boot ----------
(async () => {
  try {
    await Promise.all([['NeonJP', 'jp'], ['NeonKN', 'kn'], ['NeonTA', 'ta'], ['NeonML', 'ml'], ['NeonTE', 'te']].map(async ([fam, f]) => {
      try { const font = new FontFace(fam, `url(fonts/neon-${f}.woff)`); await font.load(); document.fonts.add(font); } catch { /* system font fallback */ }
    }));
    $('loadtext').textContent = 'Loading cars…';
    const [, tm, idx] = await Promise.all([loadCarModels((p) => { $('loadbar').style.width = Math.round(p * 100) + '%'; }, [car]), loadTrafficModels(),
      fetch('maps/index.json').then((r) => r.json())]);
    trafficModels = tm;
    // CC-BY attribution for downloaded vehicle models
    const tc = await fetch('models/traffic/credits.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const vc = { ...tc, ...VEHICLE_CREDITS };
    if (Object.keys(vc).length) document.querySelector('.credits').append(' · Vehicles (Sketchfab, CC): ' + Object.values(vc).map((c) => `${c.title} by ${c.author}`).join(', '));
    mapIndex = [...idx, TOKYO_INFO];
    rain.visible = true;
    await loadMap('bengaluru');
  } catch (e) {
    $('loadtext').textContent = 'Failed to load car model: ' + e.message;
    throw e;
  }
  if (!CAR_IDS.includes(car)) car = CAR_IDS[0];
  myVis = new CarVisual(car, color, { name });
  setCar(car);
  scene.add(myVis.root);
  refreshPaint();
  $('loading').classList.add('hidden');
  $('menu').classList.remove('hidden');
  G.phase = 'menu';
  for (const b of $('gfxSeg').children) b.onclick = () => {
    gfxSetting = b.dataset.gfx;
    try { localStorage.setItem('nh.gfx', gfxSetting); } catch { /* ignore */ }
    bench.done = false;
    applyQuality(gfxSetting === 'auto' ? 'high' : gfxSetting);
  };
  applyQuality(gfxSetting === 'auto' ? 'high' : gfxSetting);
  renderer.compile(scene, camera);
  net = new Net(netHandlers);
  renderLobby();
  syncRemoteVisuals();
  onResize();
})();
frame();

// ---------- chat ----------
const chatEl = $('chat'), chatLog = $('chatLog'), chatForm = $('chatForm'), chatInput = $('chatInput');
const chatPill = $('chatPill'), chatClose = $('chatClose'), chatBadge = $('chatBadge'), chatPeers = $('chatPeers');
let chatUnread = 0;
function openChat() {
  chatEl.classList.add('open');
  chatUnread = 0; chatBadge.classList.add('hidden'); chatBadge.textContent = '0';
  setTimeout(() => { chatInput.focus(); chatLog.scrollTop = chatLog.scrollHeight; }, 20);
}
function closeChat() {
  chatEl.classList.remove('open');
  chatInput.blur();
  if ($('emojiPanel')) toggleEmoji(false);
}
function appendChat(m) {
  const line = document.createElement('div');
  line.className = 'msg';
  const mine = m.from === net?.id;
  line.innerHTML = `<b style="color:${esc(m.color || '#8feaff')}">${esc(m.name || '?')}${mine ? ' (you)' : ''}:</b>${esc(m.text)}`;
  chatLog.appendChild(line);
  while (chatLog.children.length > 80) chatLog.removeChild(chatLog.firstChild);
  chatLog.scrollTop = chatLog.scrollHeight;
  if (!chatEl.classList.contains('open') && !mine) {
    chatUnread = Math.min(99, chatUnread + 1);
    chatBadge.textContent = chatUnread;
    chatBadge.classList.remove('hidden');
  }
}
function updateChatPeers() {
  const n = G.lobby?.players?.length || 0;
  chatPeers.textContent = n;
}
chatPill.addEventListener('click', openChat);
chatClose.addEventListener('click', closeChat);
addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
  e.preventDefault();
  openChat();
});
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { chatInput.value = ''; closeChat(); }
});
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const txt = chatInput.value.trim();
  if (txt) net?.send({ t: 'chat', text: txt });
  chatInput.value = '';
  chatInput.focus();
});
setInterval(updateChatPeers, 1000);

// Dock chat into menu-right while menu visible, float otherwise.
const menuEl = $('menu'), chatDock = $('chatDock');
const chatHomeParent = chatEl.parentNode;
const chatHomeNext = chatEl.nextSibling;
function syncChatDock() {
  const menuOpen = menuEl && !menuEl.classList.contains('hidden');
  if (menuOpen) {
    if (chatEl.parentNode !== chatDock) {
      chatDock.appendChild(chatEl);
      chatEl.classList.add('docked');
      chatEl.classList.add('open');
      chatDock.style.display = 'block';
    }
  } else {
    if (chatEl.parentNode === chatDock) {
      chatHomeParent.insertBefore(chatEl, chatHomeNext);
      chatEl.classList.remove('docked');
      chatEl.classList.remove('open');
      chatDock.style.display = 'none';
    }
  }
}
if (menuEl) new MutationObserver(syncChatDock).observe(menuEl, { attributes: true, attributeFilter: ['class'] });
syncChatDock();

// emoji picker
const EMOJIS = {
  smile: ['😀','😁','😂','🤣','😅','😊','😇','🙂','🙃','😉','😍','🥰','😘','😜','🤪','😎','🤩','🥳','🤗','🤔','🤨','😐','😑','😶','🙄','😏','😒','😔','😴','🤤','😪','😮','😲','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','🤒','🤕','🤢','🤮','🤧','🥴','😵','🤠','🥸','🤓','🧐'],
  love: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💌','😍','🥰','😘','💋','💑','💏','💐','🌹','🌷','🌺'],
  hand: ['👍','👎','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👋','🤚','🖐️','✋','🖖','👏','🙌','🤝','🙏','✍️','💪','🦾','🦵','🦶','👂','👃','🧠','👀','👁️','👅','👄'],
  car: ['🏎️','🏁','🚗','🚙','🚕','🚓','🚑','🚒','🚐','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🚨','🛞','⛽','🛣️','🛤️','🌉','🚦','🚧','🏆','🥇','🥈','🥉','🎖️','🏅','💨','🔥','⚡','💥','🌪️','☠️','💀','🤖'],
  party: ['🎉','🎊','🥳','🎈','🎁','🎀','🪅','🪩','🎆','🎇','✨','🌟','⭐','🎵','🎶','🎸','🥁','🎹','🎺','🎷','🍾','🍻','🍺','🥂','🍹','🍸','🍷','🥤','🧃','🍕','🍔','🍟','🌮','🍿','🍩','🎂','🍰'],
  object: ['⭐','🌟','✨','💫','⚡','🔥','💧','🌈','☀️','🌙','⛅','☁️','🌧️','⛈️','🌊','🪐','🌍','💎','💰','💸','🎯','🎮','🕹️','♟️','🎲','🧩','🎧','📱','💻','⌨️','🖱️','🔋','🔌','💡','🔦','🧨','🚀','🛸','👽','👾','🤖','🎃','😈','👻','💀','☠️','👹','👺']
};
const emojiBtn = $('chatEmoji'), emojiPanel = $('emojiPanel'), emojiGrid = $('emojiGrid');
let emojiCat = 'smile';
function renderEmojiGrid() {
  emojiGrid.innerHTML = '';
  for (const e of EMOJIS[emojiCat]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = e;
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      const s = chatInput.value, p = chatInput.selectionStart ?? s.length;
      chatInput.value = s.slice(0, p) + e + s.slice(chatInput.selectionEnd ?? p);
      const np = p + e.length;
      chatInput.focus();
      chatInput.setSelectionRange(np, np);
    });
    emojiGrid.appendChild(b);
  }
}
function toggleEmoji(force) {
  const show = force !== undefined ? force : emojiPanel.classList.contains('hidden');
  emojiPanel.classList.toggle('hidden', !show);
  emojiBtn.classList.toggle('on', show);
  if (show) renderEmojiGrid();
}
emojiBtn.addEventListener('click', (e) => { e.preventDefault(); toggleEmoji(); });
for (const t of document.querySelectorAll('#emojiTabs .tab')) {
  t.addEventListener('click', (e) => {
    e.preventDefault();
    emojiCat = t.dataset.cat;
    for (const x of document.querySelectorAll('#emojiTabs .tab')) x.classList.toggle('on', x === t);
    renderEmojiGrid();
  });
}
document.addEventListener('click', (e) => {
  if (!chatEl.contains(e.target) && !emojiPanel.classList.contains('hidden')) toggleEmoji(false);
});
