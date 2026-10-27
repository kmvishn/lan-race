#!/usr/bin/env python3
"""Builds static/maps/*.json from real OpenStreetMap roads (OSRM routing).

Each map is the real driving route A->B as an open two-way road. Points are in metres
(x = east, z = south), spaced 4 m, with corners tighter than MIN_R smoothed out.
Route data (c) OpenStreetMap contributors, ODbL.
"""
import html, json, math, os, re, sys, time, urllib.parse, urllib.request

MAPS = [
    dict(id='bengaluru', name='BENGALURU', sub='Outer Ring Road', a=(12.99711, 77.66885), b=(13.04769, 77.58095), start='TIN FACTORY', end='BRIGADE SENATE 2',
         keep_loops=True, min_r=12, flyover=7.0),  # real approach: off the ORR, right under it, right onto the service road
    dict(id='chennai', name='CHENNAI', sub='Marina to Besant Nagar', a=(13.06879, 80.28447), b=(13.00071, 80.27122), start='NAPIER BRIDGE', end="ELLIOT'S BEACH"),
    dict(id='mysuru', name='MYSURU', sub='Palace to Chamundi Hills', a=(12.30522, 76.65538), b=(12.27250, 76.67040), start='MYSORE PALACE', end='CHAMUNDI HILLS'),
    dict(id='wayanad', name='WAYANAD', sub='Thamarassery Ghat', a=(11.48498, 76.01261), b=(11.52057, 76.02035), start='ADIVARAM', end='LAKKIDI',
         hw=5.5, min_r=8, hairpins=True, vscale=1.8),  # two-lane ghat: keep every hairpin; climb exaggerated 1.8x
    dict(id='kannur', name='KANNUR - THALASSERY', sub='NH 66', a=(11.87150, 75.36844), b=(11.75375, 75.49247), start='KANNUR', end='THALASSERY'),
    dict(id='kochi', name='ERNAKULAM', sub='Marine Drive to Edappally', a=(9.97848, 76.27577), b=(10.02610, 76.30800), start='MARINE DRIVE', end='EDAPPALLY'),
    dict(id='trivandrum', name='THIRUVANANTHAPURAM', sub='East Fort to Kovalam', a=(8.48291, 76.94694), b=(8.39510, 76.97299), start='EAST FORT', end='KOVALAM'),
    dict(id='hyderabad', name='HYDERABAD', sub='Charminar to Tank Bund', a=(17.36160, 78.47464), b=(17.42345, 78.48580), start='CHARMINAR', end='TANK BUND'),
]
OUT = os.path.join(os.path.dirname(__file__), '..', 'static', 'maps')
PHOTOS = os.path.join(os.path.dirname(__file__), '..', 'static', 'photos')
UA = 'lan-racer-mapbuilder/1.0 (hobby LAN game; github.com/kmvishn/lan-race)'
MAX_GRADE = 0.12
FREE = re.compile(r'^(CC0|CC BY(-SA)? [0-9.]+|Public domain|PD)', re.I)
MIN_R = 20.0


def http_json(url, data=None, retries=4):
    for k in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except Exception as e:
            print('   retry', k + 1, url[:70], e)
            time.sleep(4 * (k + 1))
    raise RuntimeError('request failed: ' + url[:90])


def elevations(latlons):
    out = []
    for i in range(0, len(latlons), 100):
        chunk = latlons[i:i + 100]
        loc = '|'.join(f'{a:.6f},{b:.6f}' for a, b in chunk)
        d = http_json('https://api.opentopodata.org/v1/srtm30m?locations=' + loc)
        out += [r['elevation'] if r['elevation'] is not None else 0.0 for r in d['results']]
        time.sleep(1.1)
    return out


def osrm(a, b):
    url = f'https://router.project-osrm.org/route/v1/driving/{a[1]},{a[0]};{b[1]},{b[0]}?overview=full&geometries=geojson'
    req = urllib.request.Request(url, headers={'User-Agent': 'lan-racer map builder'})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    return d['routes'][0]['geometry']['coordinates']


def dist(p, q): return math.hypot(p[0] - q[0], p[1] - q[1])


def resample(pts, step, closed=False):
    src = pts + ([pts[0]] if closed else [])
    out = [src[0]]
    carry = 0.0
    for i in range(1, len(src)):
        a, b = src[i - 1], src[i]
        seg = dist(a, b)
        t = step - carry
        while t <= seg:
            out.append((a[0] + (b[0] - a[0]) * t / seg, a[1] + (b[1] - a[1]) * t / seg))
            t += step
        carry = seg - (t - step)
    if not closed and dist(out[-1], src[-1]) > step * 0.3: out.append(src[-1])
    if closed and dist(out[-1], out[0]) < step * 0.5: out.pop()
    return out


def remove_loops(pts, r=14.0, gap=6):
    i = 0
    while i < len(pts):
        cut = None
        for j in range(len(pts) - 1, i + gap, -1):
            if dist(pts[i], pts[j]) < r:
                cut = j; break
        if cut: pts = pts[:i + 1] + pts[cut:]
        i += 1
    return pts


def radius(a, b, c):
    ab, bc, ca = dist(a, b), dist(b, c), dist(c, a)
    cross = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
    return float('inf') if cross < 1e-9 else ab * bc * ca / (2 * cross)


def min_radius(pts, k, closed=False):
    n = len(pts); best = float('inf')
    rng = range(n) if closed else range(k, n - k)
    for i in rng:
        best = min(best, radius(pts[(i - k) % n], pts[i], pts[(i + k) % n]))
    return best


def smooth(pts, iters, closed=False, fixed=3):
    p = list(pts); n = len(p)
    for _ in range(iters):
        q = list(p)
        for i in range(n):
            if not closed and (i < fixed or i >= n - fixed): continue
            a, b, c = p[(i - 1) % n], p[i], p[(i + 1) % n]
            q[i] = (b[0] * 0.5 + (a[0] + c[0]) * 0.25, b[1] * 0.5 + (a[1] + c[1]) * 0.25)
        p = q
    return p


def local_smooth(pts, min_r, rounds=400):
    """Smooths only around corners tighter than min_r so the rest of the real road keeps its shape."""
    n = len(pts)
    for _ in range(rounds):
        bad = [i for i in range(2, n - 2) if radius(pts[i - 2], pts[i], pts[i + 2]) < min_r]
        if not bad: break
        mask = set()
        for i in bad:
            mask.update(range(max(3, i - 10), min(n - 3, i + 11)))
        q = list(pts)
        for i in mask:
            a, b, c = pts[i - 1], pts[i], pts[i + 1]
            q[i] = (b[0] * 0.5 + (a[0] + c[0]) * 0.25, b[1] * 0.5 + (a[1] + c[1]) * 0.25)
        pts = q
    return pts


def taubin(pts, min_r, rounds=800, lam=0.5, mu=-0.53):
    """Taubin (shrink-free) smoothing around corners tighter than min_r."""
    n = len(pts)
    for _ in range(rounds):
        bad = [i for i in range(2, n - 2) if radius(pts[i - 2], pts[i], pts[i + 2]) < min_r]
        if not bad: break
        mask = set()
        for i in bad: mask.update(range(max(3, i - 10), min(n - 3, i + 11)))
        for f in (lam, mu):
            q = list(pts)
            for i in mask:
                a, b, c = pts[i - 1], pts[i], pts[i + 1]
                q[i] = (b[0] + f * ((a[0] + c[0]) / 2 - b[0]), b[1] + f * ((a[1] + c[1]) / 2 - b[1]))
            pts = q
    return pts


def raise_flyovers(route, heights, lift, near=30, ramp=200):
    """Where the route later comes back within `near` m of itself (e.g. doubling back on a service road under an
    elevated ring road), lift the earlier stretch into a flyover with smooth ramps, so the two never cross at grade."""
    cum = [0.0]
    for i in range(1, len(route)): cum.append(cum[-1] + dist(route[i - 1], route[i]))
    spans = []
    for i in range(0, len(route), 3):
        for j in range(i + 40, len(route), 3):
            if cum[j] - cum[i] > 150 and dist(route[i], route[j]) < near:
                if spans and cum[i] - spans[-1][1] < 60: spans[-1][1] = cum[i]
                else: spans.append([cum[i], cum[i]])
                break
    out = list(heights)
    for a, b in spans:
        for i, d in enumerate(cum):
            if a - ramp < d < b + ramp:
                k = 1 if a <= d <= b else (d - (a - ramp)) / ramp if d < a else ((b + ramp) - d) / ramp
                out[i] = heights[i] + lift * (k * k * (3 - 2 * k))
        print(f'   flyover {a:.0f}-{b:.0f} m (+{lift} m)')
    return out


def build(m):
    coords = osrm(m['a'], m['b'])
    lat0 = sum(c[1] for c in coords) / len(coords); lon0 = sum(c[0] for c in coords) / len(coords)
    kx = 111320 * math.cos(math.radians(lat0)); kz = 110574
    pts = [((lon - lon0) * kx, -(lat - lat0) * kz) for lon, lat in coords]
    min_r = m.get('min_r', MIN_R)
    if m.get('hairpins') or m.get('keep_loops'):  # keep the real path (hairpins, U-turns under flyovers): no loop removal
        pts = local_smooth(taubin(resample(pts, 4), 12), min_r)
    else:
        pts = resample(remove_loops(resample(pts, 4)), 8)
        pts = remove_loops(pts, 24, 4)
        pts = smooth(pts, 4)
        pts = local_smooth(pts, min_r)
    route = resample(pts, 4)
    route = local_smooth(route, min_r, 200)
    route_len = sum(dist(route[i], route[i + 1]) for i in range(len(route) - 1))
    r8 = resample(route, 8)
    to_ll = lambda x, z: (lat0 - z / kz, lon0 + x / kx)

    # Road elevation: SRTM every ~30 m, smoothed, gradient-limited, then mapped onto every route point.
    coarse = route[::8]
    hs = elevations([to_ll(x, z) for x, z in coarse])
    hs = [sorted(hs[max(0, i - 2):i + 3])[len(hs[max(0, i - 2):i + 3]) // 2] for i in range(len(hs))]
    for _ in range(4):
        hs = [sum(hs[max(0, i - 3):i + 4]) / len(hs[max(0, i - 3):i + 4]) for i in range(len(hs))]
    for _ in range(50):
        changed = False
        for i in range(1, len(hs)):
            lim = MAX_GRADE * 32
            if abs(hs[i] - hs[i - 1]) > lim:
                mid = (hs[i] + hs[i - 1]) / 2
                hs[i - 1] = mid - math.copysign(lim / 2, hs[i] - hs[i - 1]); hs[i] = mid + math.copysign(lim / 2, hs[i] - hs[i - 1])
                changed = True
        if not changed: break
    base = min(hs)
    heights = []
    for i in range(len(route)):
        f = i / 8; k = min(int(f), len(hs) - 2); t = f - k
        heights.append((hs[k] + (hs[k + 1] - hs[k]) * t - base) * m.get('vscale', 1))
    if m.get('flyover'): heights = raise_flyovers(route, heights, m['flyover'])

    # Terrain: coarse SRTM grid in a corridor around the road.
    step = 150.0; reach = 1300.0
    xs = [p[0] for p in route]; zs = [p[1] for p in route]
    x0, z0 = min(xs) - reach, min(zs) - reach
    nx, nz = int((max(xs) + reach - x0) / step) + 1, int((max(zs) + reach - z0) / step) + 1
    near = [p for p in route[::25]]
    want = []
    for j in range(nz):
        for i in range(nx):
            gx, gz = x0 + i * step, z0 + j * step
            if min((gx - p[0]) ** 2 + (gz - p[1]) ** 2 for p in near) < reach * reach: want.append((i, j))
    gh = elevations([to_ll(x0 + i * step, z0 + j * step) for i, j in want])
    grid = [None] * (nx * nz)
    for (i, j), h in zip(want, gh): grid[j * nx + i] = round((h - base) * m.get('vscale', 1), 1)

    pois = find_pois(m, route, to_ll, lat0, lon0, kx, kz)
    rise = max(heights) - min(heights)
    print(f"{m['id']:>11}: {route_len / 1000:5.1f} km, min radius {min_radius(r8, 2):.0f} m, climb {rise:.0f} m, "
          f"grid {nx}x{nz} ({len(want)} pts), {len(pois)} landmarks")
    return {
        'id': m['id'], 'name': m['name'], 'sub': m['sub'], 'start': m['start'], 'end': m['end'],
        'length': round(route_len, 1), 'origin': [round(lat0, 6), round(lon0, 6)], 'baseElevation': round(base, 1),
        'roadHalfWidth': m.get('hw', 9.0), 'vScale': m.get('vscale', 1),
        'points': [[round(x, 1), round(z, 1), round(h, 2)] for (x, z), h in zip(route, heights)],
        'terrain': {'x0': round(x0, 1), 'z0': round(z0, 1), 'step': step, 'nx': nx, 'nz': nz, 'h': grid},
        'pois': pois,
    }


POI_FILTERS = ['["tourism"~"attraction|museum|viewpoint|gallery"]', '["historic"]', '["amenity"~"place_of_worship|university|college|hospital|bus_station"]',
               '["shop"="mall"]', '["leisure"~"stadium|park"]', '["man_made"~"lighthouse|tower"]', '["railway"="station"]', '["office"]', '["building"]']


def classify(t):
    name = t.get('name', '').lower()
    if t.get('man_made') == 'lighthouse' or 'lighthouse' in name: return 'lighthouse'
    if t.get('historic') in ('fort', 'castle') or ' fort' in name: return 'fort'
    if t.get('amenity') == 'place_of_worship' or t.get('building') in ('temple', 'church', 'mosque', 'cathedral'):
        rel = t.get('religion', '')
        if rel == 'christian' or 'church' in name or 'cathedral' in name: return 'church'
        if rel == 'muslim' or 'masjid' in name or 'mosque' in name: return 'mosque'
        return 'gopuram'
    if 'palace' in name or t.get('historic') in ('palace', 'monument', 'memorial', 'building'): return 'heritage'
    if t.get('tourism') in ('museum', 'gallery'): return 'heritage'
    if t.get('shop') == 'mall' or 'mall' in name: return 'mall'
    if t.get('leisure') == 'stadium' or 'stadium' in name: return 'stadium'
    if t.get('leisure') == 'park' or 'park' == name.split()[-1:]: return 'park'
    if t.get('railway') == 'station' or 'station' in name: return 'station'
    if t.get('amenity') in ('university', 'college') or 'college' in name or 'university' in name: return 'campus'
    if t.get('amenity') == 'hospital' or 'hospital' in name: return 'hospital'
    if 'tech' in name or ' it ' in f' {name} ' or t.get('office'): return 'techpark'
    return 'tower'


def commons_photo(title, fname):
    q = urllib.parse.urlencode({'action': 'query', 'titles': 'File:' + title, 'prop': 'imageinfo', 'iiprop': 'url|extmetadata', 'iiurlwidth': 640, 'format': 'json'})
    d = http_json('https://commons.wikimedia.org/w/api.php?' + q)
    page = next(iter(d['query']['pages'].values()))
    if 'imageinfo' not in page: return None
    ii = page['imageinfo'][0]; md = ii.get('extmetadata', {})
    lic = md.get('LicenseShortName', {}).get('value', '')
    if not FREE.match(lic): return None
    artist = re.sub('<[^>]+>', '', html.unescape(md.get('Artist', {}).get('value', 'Unknown'))).strip()[:80]
    req = urllib.request.Request(ii['thumburl'], headers={'User-Agent': UA})
    os.makedirs(PHOTOS, exist_ok=True)
    with urllib.request.urlopen(req, timeout=60) as r, open(os.path.join(PHOTOS, fname), 'wb') as f: f.write(r.read())
    time.sleep(0.5)
    return {'file': 'photos/' + fname, 'credit': f'{artist} · {lic} · Wikimedia Commons', 'source': ii.get('descriptionurl', '')}


WD_TYPES = [('lighthouse', 'lighthouse'), ('fort', 'fort'), ('palace', 'heritage'), ('cathedral', 'church'), ('basilica', 'church'),
            ('church', 'church'), ('mosque', 'mosque'), ('masjid', 'mosque'), ('dargah', 'mosque'), ('temple', 'gopuram'), ('shrine', 'gopuram'),
            ('museum', 'heritage'), ('monument', 'heritage'), ('memorial', 'heritage'), ('statue', 'heritage'), ('heritage', 'heritage'),
            ('railway station', 'station'), ('metro station', 'station'), ('bus station', 'station'), ('stadium', 'stadium'),
            ('shopping', 'mall'), ('university', 'campus'), ('college', 'campus'), ('institute', 'campus'), ('hospital', 'hospital'),
            ('waterfall', 'viewpoint'), ('mountain pass', 'viewpoint'), ('viewpoint', 'viewpoint'), ('tourist attraction', 'viewpoint'), ('lake', 'park'),
            ('garden', 'park'), ('park', 'park'), ('skyscraper', 'tower'), ('office', 'techpark'), ('building', 'tower')]
SKIP = re.compile(r'school|police|bazaa?r|market|village|town|city|ward|constituency|neighbou?rhood|suburb|river|road|highway|human|district|taluk|panchayat|locality', re.I)


def wd_near(route, to_ll):
    """Wikidata items with a photo near the route (famous buildings OSM may not link)."""
    found = {}
    for x, z in route[::350]:
        lat, lon = to_ll(x, z)
        q = ('SELECT ?item ?itemLabel ?img ?coord ?links (GROUP_CONCAT(DISTINCT ?tl; separator="|") AS ?types) WHERE {'
             'SERVICE wikibase:around { ?item wdt:P625 ?coord. bd:serviceParam wikibase:center "Point(%f %f)"^^geo:wktLiteral; wikibase:radius "0.9". }'
             '?item wdt:P18 ?img; wikibase:sitelinks ?links. OPTIONAL { ?item wdt:P31 ?t. ?t rdfs:label ?tl FILTER(lang(?tl)="en") }'
             'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } GROUP BY ?item ?itemLabel ?img ?coord ?links') % (lon, lat)
        try:
            d = http_json('https://query.wikidata.org/sparql?' + urllib.parse.urlencode({'query': q, 'format': 'json'}))
        except Exception as e:
            print('   wikidata skipped', e); continue
        for b in d['results']['bindings']:
            qid = b['item']['value'].rsplit('/', 1)[-1]
            types = b.get('types', {}).get('value', '').lower()
            name = b['itemLabel']['value']
            if qid in found or re.fullmatch(r'Q\d+', name) or not types or SKIP.search(types): continue
            kind = next((k for w, k in WD_TYPES if w in types or w in name.lower()), None)
            if not kind: continue
            m = re.match(r'Point\(([-0-9.]+) ([-0-9.]+)\)', b['coord']['value'])
            if not m: continue
            found[qid] = {'qid': qid, 'name': name, 'type': kind, 'lat': float(m.group(2)), 'lon': float(m.group(1)),
                          'img': urllib.parse.unquote(b['img']['value'].rsplit('/', 1)[-1]), 'links': int(b['links']['value'])}
        time.sleep(1)
    return found


def find_pois(m, route, to_ll, lat0, lon0, kx, kz, limit=10):
    line = ','.join(f'{a:.5f},{b:.5f}' for a, b in (to_ll(x, z) for x, z in route[::30]))
    body = '[out:json][timeout:180];(' + ''.join(f'nwr(around:450,{line})["wikidata"]["name"]{f};' for f in POI_FILTERS) + ');out center tags;'
    d = http_json('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': body}).encode())
    cands = {}

    def add(qid, name, kind, lat, lon, score, img=None):
        x, z = (lon - lon0) * kx, -(lat - lat0) * kz
        best = min(range(0, len(route), 3), key=lambda i: (route[i][0] - x) ** 2 + (route[i][1] - z) ** 2)
        off = math.hypot(route[best][0] - x, route[best][1] - z)
        if off < 25 or off > 450: return
        c = cands.get(qid)
        if c:
            c['score'] += score; c['img'] = c.get('img') or img; return
        cands[qid] = {'qid': qid, 'name': name, 'type': kind, 'x': round(x, 1), 'z': round(z, 1), 'idx': best, 'off': round(off, 1),
                      'score': score - off / 150, 'img': img}

    for e in d['elements']:
        t = e.get('tags', {}); c = e.get('center', e)
        if 'lat' not in c or t.get('place') or t.get('boundary') or t.get('highway'): continue
        if t.get('amenity') in ('school', 'kindergarten') or SKIP.search(t.get('name', '')): continue
        score = (2 if t.get('wikipedia') else 0) + (1 if t.get('tourism') or t.get('historic') else 0) + (1 if t.get('amenity') == 'place_of_worship' else 0)
        add(t['wikidata'], t.get('name:en') or t['name'], classify(t), c['lat'], c['lon'], score)
    for w in wd_near(route, to_ll).values():
        add(w['qid'], w['name'], w['type'], w['lat'], w['lon'], 2 + min(w['links'], 30) / 3, w['img'])

    chosen = []
    for c in sorted(cands.values(), key=lambda c: -c['score']):
        if any(abs(c['idx'] - o['idx']) < 110 for o in chosen): continue
        chosen.append(c)
        if len(chosen) >= limit: break
    out = []
    for n, c in enumerate(sorted(chosen, key=lambda c: c['idx'])):
        photo, img = None, c.pop('img')
        try:
            ent = http_json(f"https://www.wikidata.org/wiki/Special:EntityData/{c['qid']}.json")['entities']
            ent = next(iter(ent.values()))
            c['name'] = ent.get('labels', {}).get('en', {}).get('value', c['name'])
            p18 = ent.get('claims', {}).get('P18', [])
            img = img or (p18[0]['mainsnak']['datavalue']['value'] if p18 else None)
            if img: photo = commons_photo(img, f"{m['id']}-{n}.jpg")
        except Exception as e:
            print('   photo skipped for', c['name'], e)
        time.sleep(0.5)
        c.pop('score')
        if photo: c.update(photo)
        out.append(c)
    return out


def refresh_pois(m, path):
    """Re-picks landmarks/photos for an existing map file without re-fetching elevations."""
    with open(path) as f: d = json.load(f)
    lat0, lon0 = d['origin']
    kx = 111320 * math.cos(math.radians(lat0)); kz = 110574
    route = [(p[0], p[1]) for p in d['points']]
    to_ll = lambda x, z: (lat0 - z / kz, lon0 + x / kx)
    for p in d.get('pois', []):
        if p.get('file'):
            try: os.remove(os.path.join(PHOTOS, os.path.basename(p['file'])))
            except OSError: pass
    d['pois'] = find_pois(m, route, to_ll, lat0, lon0, kx, kz)
    print(f"{m['id']:>11}: {len(d['pois'])} landmarks, {sum(1 for p in d['pois'] if p.get('file'))} photos")
    return d


def find_stops(route, to_ll, lat0, lon0, kx, kz, spacing=700, limit=14):
    """Named bus stops on the route (OSM), spaced out along it: the route's checkpoints."""
    line = ','.join(f'{a:.5f},{b:.5f}' for a, b in (to_ll(x, z) for x, z in route[::15]))
    body = ('[out:json][timeout:120];(' + f'node(around:35,{line})["highway"="bus_stop"]["name"];'
            + f'node(around:35,{line})["public_transport"="platform"]["bus"="yes"]["name"];' + ');out;')
    d = http_json('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': body}).encode())
    cum = [0.0]
    for i in range(1, len(route)): cum.append(cum[-1] + dist(route[i - 1], route[i]))
    found = {}
    for e in d['elements']:
        t = e.get('tags', {})
        name = (t.get('name:en') or t['name']).strip()
        if name == name.lower(): name = name.title()  # some OSM names are all lowercase
        x, z = (e['lon'] - lon0) * kx, -(e['lat'] - lat0) * kz
        i = min(range(0, len(route), 2), key=lambda k: (route[k][0] - x) ** 2 + (route[k][1] - z) ** 2)
        if math.hypot(route[i][0] - x, route[i][1] - z) > 40: continue
        key = re.sub(r'\W+', '', name.lower())
        if key not in found: found[key] = {'name': name, 'd': round(cum[i]), 'x': round(x, 1), 'z': round(z, 1)}
    picked = []
    for st in sorted(found.values(), key=lambda q: q['d']):
        if st['d'] < 300 or st['d'] > cum[-1] - 300: continue
        if picked and st['d'] - picked[-1]['d'] < spacing: continue
        picked.append(st)
    if len(picked) > limit:  # keep an even spread
        picked = [picked[round(k * (len(picked) - 1) / (limit - 1))] for k in range(limit)]
    return picked


def hairpins(route, cum, stops, total=9):
    """Numbered hairpin bends. Hairpins named in OSM (e.g. a "7th Hair pin bend" bus stop) anchor the numbering; the
    others are the sharpest bends (heading turns back >120 degrees within 120 m) before/after the anchors."""
    h = [math.atan2(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1]) for i in range(len(route) - 1)]
    turn = sorted(((abs((h[i + 15] - h[i - 15] + math.pi) % (2 * math.pi) - math.pi), i) for i in range(15, len(h) - 15)), reverse=True)
    cands = []
    for a, i in turn:
        if a < math.radians(120): break
        if all(abs(cum[i] - cum[j]) > 150 for j in cands): cands.append(i)
    anchors = {}
    for q in stops:
        mt = re.match(r'\s*(\d+)\s*\w*\s*hair', q['name'], re.I)
        if mt: anchors[int(mt.group(1))] = q['d']
    if not anchors: return [{'name': f'Hairpin {k + 1}', 'd': round(cum[i]), 'x': round(route[i][0], 1), 'z': round(route[i][1], 1)} for k, i in enumerate(sorted(cands[:total]))]
    lo, hi = min(anchors), max(anchors)
    near = lambda d: min(range(len(cum)), key=lambda k: abs(cum[k] - d))
    picked = {n: near(d) for n, d in anchors.items()}
    below = sorted([i for i in cands if cum[i] < anchors[lo] - 150][:lo - 1])  # strongest bends, then in road order
    above = sorted([i for i in cands if cum[i] > anchors[hi] + 150][:total - hi])
    for n, i in zip(range(1, lo), below): picked[n] = i
    for n, i in zip(range(hi + 1, total + 1), above): picked[n] = i
    return [{'name': f'Hairpin {n}', 'd': round(cum[i]), 'x': round(route[i][0], 1), 'z': round(route[i][1], 1)} for n, i in sorted(picked.items(), key=lambda q: cum[q[1]])]


def refresh_stops(m, path, gap=1800):
    with open(path) as f: d = json.load(f)
    lat0, lon0 = d['origin']
    kx = 111320 * math.cos(math.radians(lat0)); kz = 110574
    route = [(p[0], p[1]) for p in d['points']]
    cum = [0.0]
    for i in range(1, len(route)): cum.append(cum[-1] + dist(route[i - 1], route[i]))
    stops = find_stops(route, lambda x, z: (lat0 - z / kz, lon0 + x / kx), lat0, lon0, kx, kz)
    if m.get('hairpins'): stops = sorted(hairpins(route, cum, stops) + [q for q in stops if 'hair' not in q['name'].lower()], key=lambda q: q['d'])
    # fill long gaps with the route's landmarks
    extra = [{'name': q['name'], 'd': round(cum[min(q['idx'], len(cum) - 1)]), 'x': q['x'], 'z': q['z']} for q in d.get('pois', [])]
    while True:
        marks = [0] + [q['d'] for q in stops] + [cum[-1]]
        gaps = sorted(((marks[k + 1] - marks[k], marks[k], marks[k + 1]) for k in range(len(marks) - 1) if marks[k + 1] - marks[k] > gap), reverse=True)
        placed = False
        for _, a, b in gaps:
            inside = [q for q in extra if a + 400 < q['d'] < b - 400]
            if inside:
                best = min(inside, key=lambda q: abs(q['d'] - (a + b) / 2))
                stops = sorted(stops + [best], key=lambda q: q['d']); extra.remove(best); placed = True
                break
        if not placed: break
    d['stops'] = stops
    print(f"{m['id']:>11}: {len(d['stops'])} stops: " + ', '.join(q['name'] for q in d['stops']))
    time.sleep(2)
    return d


def main():
    os.makedirs(OUT, exist_ok=True)
    args = sys.argv[1:]
    pois_only, stops_only = '--pois' in args, '--stops' in args
    only = set(a for a in args if not a.startswith('--'))
    index = []
    for m in MAPS:
        path = os.path.join(OUT, m['id'] + '.json')
        if not only or m['id'] in only:
            data = refresh_pois(m, path) if pois_only else refresh_stops(m, path) if stops_only else build(m)
            with open(path, 'w') as f: json.dump(data, f, separators=(',', ':'))
        with open(path) as f: d = json.load(f)
        e = {k: d[k] for k in ('id', 'name', 'sub', 'start', 'end', 'length')}
        pts = d['points']; k = max(1, len(pts) // 160)
        e['route'] = [[round(q[0]), round(q[1]), round(q[2])] for q in pts[::k] + [pts[-1]]]
        e['climb'] = round(max(q[2] for q in pts) - min(q[2] for q in pts))
        e['pois'] = [{'name': q['name'], 'type': q['type'], 'x': round(q['x']), 'z': round(q['z'])} for q in d.get('pois', [])]
        index.append(e)
    with open(os.path.join(OUT, 'index.json'), 'w') as f: json.dump(index, f, separators=(',', ':'))
    credits = []
    for m in MAPS:
        with open(os.path.join(OUT, m['id'] + '.json')) as f: d = json.load(f)
        for p in d.get('pois', []):
            if p.get('credit'): credits.append(f"- {p['name']} ({d['name']}): {p['credit']} — {p['source']}")
    with open(os.path.join(OUT, '..', '..', 'PHOTO_CREDITS.md'), 'w') as f:
        f.write('# Photo credits\n\nLandmark photos shown on in-game boards, from Wikimedia Commons under the licences listed.\n\n' + '\n'.join(credits) + '\n')


if __name__ == '__main__':
    main()
