// Player state on the wire: [x, z, yaw, height, pitch, vx, vz, steer, flags (nitro 1 | brake 2 | drift 4), progress,
// finish ms, pursuit bounty?, pursuit cops?]
export function unpackState(a) {
  return { x: a[0], z: a[1], y: a[2], h: a[3], pp: a[4], vx: a[5], vz: a[6], st: a[7], n: a[8] & 1, br: (a[8] >> 1) & 1, d: (a[8] >> 2) & 1,
    p: a[9], f: a[10], b: a[11], c: a[12] };
}

export class Net {
  constructor(handlers) {
    this.h = handlers;
    this.id = null;
    this.offset = 0; this.target = 0;
    this.bestRtt = Infinity;
    this.remotes = new Map(); // id -> {buf:[{t,s}]}
    this.open = false;
    this.connect();
  }

  connect() {
    const ws = this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { this.open = true; this.ping(); this.pingTimer = setInterval(() => this.ping(), 1500); this.h.open?.(); };
    ws.onclose = () => {
      this.open = false; clearInterval(this.pingTimer);
      this.h.close?.();
      setTimeout(() => this.connect(), 1500);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      switch (m.t) {
        case 'welcome': this.id = m.id; this.offset = this.target = m.now - performance.now(); this.h.welcome?.(m); break;
        case 'pong': {
          const now = performance.now(), rtt = now - m.c;
          if (rtt < this.bestRtt * 1.2) { this.bestRtt = Math.min(this.bestRtt, rtt); this.target = m.now + rtt / 2 - now; }
          this.rtt = rtt;
          break;
        }
        case 'snap': this.onSnap(m); break;
        case 'leave': this.remotes.delete(m.id); this.h.leave?.(m.id); break;
        default: this.h[m.t]?.(m);
      }
    };
  }

  send(o) { if (this.open) this.ws.send(JSON.stringify(o)); }
  ping() { this.send({ t: 'ping', c: performance.now() }); }
  // Server clock. Corrections are slewed (at most 2 ms per call) so race time and traffic never visibly jump.
  now() {
    const d = this.target - this.offset;
    this.offset += Math.abs(d) > 1000 ? d : Math.max(-2, Math.min(2, d));
    return performance.now() + this.offset;
  }

  onSnap(m) {
    for (const p of m.p) {
      if (p.id === this.id) continue;
      let r = this.remotes.get(p.id);
      if (!r) { r = { buf: [] }; this.remotes.set(p.id, r); }
      const s = unpackState(p.s);
      r.buf.push({ t: m.now, s });
      r.recv = performance.now();
      if (r.buf.length > 30) r.buf.shift();
      r.last = s;
    }
  }

  // Interpolated state for a remote player at renderTime (server ms).
  sampleRemote(id, renderTime, out) {
    const r = this.remotes.get(id);
    if (!r || !r.buf.length) return null;
    const b = r.buf;
    if (renderTime <= b[0].t) return Object.assign(out, b[0].s);
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > renderTime) i--;
    const B = b[i], A = b[Math.max(0, i - 1)];
    const s = B.s;
    Object.assign(out, s);
    if (A !== B && renderTime <= B.t) {
      const k = Math.max(0, Math.min(1, (renderTime - A.t) / (B.t - A.t || 1)));
      out.x = A.s.x + (B.s.x - A.s.x) * k;
      out.z = A.s.z + (B.s.z - A.s.z) * k;
      let dy = B.s.y - A.s.y;
      if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
      out.y = A.s.y + dy * k;
    } else {
      const ex = Math.max(0, Math.min(0.25, (renderTime - B.t) / 1000));
      out.x = s.x + s.vx * ex; out.z = s.z + s.vz * ex;
    }
    return out;
  }
}
