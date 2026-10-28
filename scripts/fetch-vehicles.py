#!/usr/bin/env python3
"""Downloads the player vehicles from Sketchfab (CC-BY / CC-BY-SA / CC0 only), optimizes them for the game and
writes their credits. Needs a Sketchfab API token (Settings -> Password & API) in SKETCHFAB_TOKEN; it is only used
for the download requests and never written to disk.

    SKETCHFAB_TOKEN=... python3 scripts/fetch-vehicles.py [id ...]

Textures become GPU-compressed KTX2 when KTX-Software's `toktx` is on PATH (only needed here, not by players);
otherwise WebP.
"""
import csv, json, os, shutil, struct, subprocess, sys, tempfile, time, urllib.error, urllib.request, zipfile

ROOT = os.path.join(os.path.dirname(__file__), '..', 'static', 'models')
SCRIPTS = os.path.dirname(os.path.abspath(__file__))
UA = 'lan-racer-assets/1.0 (hobby LAN game)'
FREE = {'by', 'by-sa', 'cc0'}
# id: (sketchfab uid, player triangle budget or None, traffic triangle budget or None)
VEHICLES = {
    'swift': ('07cf082bab4d430a8a764a23590e35fa', 60000, 14000),
    'dzire': ('885c8f08674f48d7a54706fee791402f', 60000, 14000),
    'baleno': ('a12eae7b7c654ec39828122981aa7bad', 60000, 14000),
    'city': ('75671276d4da476294202a5dc050a99e', 60000, 14000),
    'creta': ('67645b6f549441a786e2b4050dc0268b', 70000, 16000),
    'thar': ('66ee970b18014c98a1750064b65657b0', 70000, None),
    'scorpio': ('027c4f62a76e402c8540e3e7670b583e', 70000, 16000),
    'bmw3': ('28f0bc2f0083417a8e521150529034d6', 60000, None),
    'a4': ('56c41d1406134dfc9d91be6193be9801', 60000, None),
    'cclass': ('19d59344b7554e6ab614a6cc02e7ad0a', 70000, None),
    'q7': ('d4a18a7aa15f4a34a2cb159e593d948f', 70000, None),
    'activa': ('de84863d474d4276ae52ff9ab72337bb', 30000, 6000),
    'scooter125': ('0162842f5bda4ef3b30972fd634c10bb', 30000, 6000),
    'pulsar': ('06fac75c72ed4780a19034447c81e72c', 35000, 7000),
    'apache': ('916198718ea84dd5932b324a1dc5fb61', 35000, 7000),
    'ninja': ('865feab0105442f3b7aca78f663b6c79', 35000, None),
    'duke390': ('d6616c83ea324308bd36e34ea745b5e1', 30000, None),  # stylized Super Duke body
    'punch': ('1a85da7678ba4f708cfbee0d9303c5d7', 50000, 14000),
    'seltos': ('f1d5c26452cf43acb9f154fc076097e5', 60000, 14000),
    'xuv3xo': ('816995d6c3454462b62c8c44ea39ae65', 50000, 14000),
    'ambassador': ('a84ef7126b2b43adb7b4b28a4d42e5fb', 30000, 12000),
    'fz': ('c522b1bae9c2425db12d435ecb5e8783', 30000, 7000),
    'rx100': ('7615fba3db6e4e1ebd0d11eac80a0050', 30000, 7000),
    'policejeep': ('60ece47d1a6b48fab121b26706a9bae2', 30000, None),
    'swiftsport': ('00a05ca44b4345acbc0540e1e9517db9', 60000, None),
    # popular in Kerala / Karnataka, and the luxury end of the road
    'innova': ('43a8142b29d542de817e9f64f5ec1846', 70000, 14000),
    'fortuner': ('379e4180f137480b9a8578e7da9184e2', 70000, 16000),
    'camry': ('236a5a6e2fa6420fbdf641f4800cd544', 70000, 14000),
    'landcruiser': ('374e85a6e18743429f6d9c0e7bbffb3c', 70000, 16000),
    'eclass': ('119c5e10733142b197aa53b86f6aeb04', 70000, 14000),
    'sclass': ('f42d9d13b0404b5b9a2302a4c590a94d', 80000, None),
    'maybach': ('34c4687ba8204efaa7551afea9f5689f', 80000, None),
    'gclass': ('1a2a52b16cad4e618af347461817895c', 60000, None),
    'bmw7': ('0806c39847ae42e5996917f50527dda0', 70000, 14000),
    'x5': ('08b867223842444baaf88bd442991c5f', 70000, 14000),
    'a6': ('43c266f6ea494ec59a1306084c30226c', 70000, 14000),
    'q5': ('9cf08cf1dac24654a34dbdad76cce52c', 70000, None),
    'rangerover': ('dd8455bdfa3247feb906145fa2abca03', 70000, None),
    'rrsport': ('c1105996547b4c4c8a4cfc3523a4c726', 80000, None),
    'defender': ('88e5f30687ec4d508cebafa876e014d6', 70000, None),
    'p911': ('4cef7c1e22ab40fd937507eae9a62cd8', 80000, None),
    'lexuslx': ('605997db34c445898e4e92c8f4524378', 80000, None),
    'm3gtr': ('6bb4d180cd0d454ba62fbfae24fc5155', 70000, None),  # the real 2001 BMW Motorsport E46 M3 GTR
    'm800': ('b7a9057643da422c972dfa5971d51c39', 60000, None),  # widebody custom Maruti 800
    # traffic only
    'xuv700': ('a7877a0a18ba48af904af0216912b719', None, 12000),
    'tataace': ('a7d929f5c0c74838984fcfb6641c4612', None, 6000),
    'eeco': ('c213330eb27d472e81fe7afdaf25bebf', None, 6000),
    'eicher': ('516d4dcfc0d2447ab558f6ed1363efed', None, 8000),
    'tractor': ('68fffe30eea4457eae371462c93990f9', None, 12000),
    'ertiga': ('b2d30fc3f98548e5b44fada4029efa86', None, 14000),
    'wagonr': ('6700812ecaa840199bdc31fc3b921385', None, 14000),
    'bolero': ('9f1e594c45e24012b50992bbfeeecda0', None, 14000),
    'auto': ('5775d012693741008acff9dad410e92d', 20000, 8000),
    'olaev': ('54a28e841f494f7496468f06aa36fbcb', None, 6000),
    'deliveryev': ('16a3330edde14cb7b56626ede007067f', None, 4000),
    'viking': ('4daaa992332f43419f85783a120cea44', None, 22000),
    'citybus': ('67b7998f0f3341a8a96655f96adc1a77', None, 22000),
    'keralabus': ('f2d7bd2c567a4fcdb5064c3f4999ec35', 90000, 22000),  # Kerala private stage bus
    'ksrtc': ('2d4ab65f7a7c470ab14da987a6248b5e', None, 22000),  # KSRTC yellow/red
    'tatatruck': ('52bb6a5e030c4fde8c3e0ee977447f4f', 60000, 20000),
    'tatalorry': ('b86c47f6a28347b3a942e33dae1af6f5', 40000, 18000),
}
TRANSFORM = ['npx', '--yes', '@gltf-transform/cli@4']


def api(path, token=None):
    headers = {'User-Agent': UA}
    if token: headers['Authorization'] = 'Token ' + token
    for k in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request('https://api.sketchfab.com/v3/' + path, headers=headers), timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or k == 5: raise
            time.sleep(20 * (k + 1))  # rate limited


def fetch(url, path):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=600) as r, open(path, 'wb') as f:
        while chunk := r.read(1 << 20): f.write(chunk)


def node_tools():
    if not os.path.isdir(os.path.join(SCRIPTS, 'node_modules')):
        subprocess.run(['npm', 'install', '--silent', '--prefix', SCRIPTS], check=True, capture_output=True)


def triangles(path):
    """Triangles drawn by an (uncompressed) GLB, instanced meshes counted per use."""
    node_tools()
    return int(subprocess.run(['node', os.path.join(SCRIPTS, 'triangles.mjs'), path], check=True, capture_output=True, text=True).stdout)


TEXTURES = 'ktx2' if shutil.which('toktx') else 'webp'
# Distant traffic stays WebP at 512 px: ETC1S at that size shows artefacts, and close-ups use the KTX2 player model.
TRAFFIC_TEXTURES = 'webp'


def image_count(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    return len(json.loads(b[20:20 + n]).get('images', []))


def optimize(raw, out, faces, budget, tex):
    """Simplifies until the model fits its triangle budget, loosening the error bound as needed, then compresses
    geometry and textures once (texture encoding, KTX2 especially, is the slow part)."""
    ratio = min(1.0, budget / max(faces, 1))
    keep = ['--instance', 'false', '--join', 'false', '--flatten', 'false', '--palette', 'false']
    geo = out + '.geo.glb'
    for err in (0.003, 0.01, 0.025, 0.05, 0.1, 0.2):
        cmd = TRANSFORM + ['optimize', raw, geo, '--compress', 'false', '--texture-compress', 'false'] + keep
        cmd += ['--simplify', 'true', '--simplify-ratio', f'{ratio:.3f}', '--simplify-error', str(err)] if ratio < 0.95 else ['--simplify', 'false']
        subprocess.run(cmd, check=True, capture_output=True)
        tris = triangles(geo)
        if ratio >= 0.95 or tris <= budget * 1.3: break
    if tris > budget * 1.3:  # seams everywhere: the regular simplifier can't collapse anything, use the sloppy one
        node_tools()
        subprocess.run(['node', os.path.join(SCRIPTS, 'simplify-sloppy.mjs'), geo, geo, str(budget), '0.02' if tex > 512 else '0.05'], check=True, capture_output=True)
        tris = triangles(geo)
    # models with lots of textures (badges, lights, decals each in their own image) get half-size ones: GPU memory
    # and download size grow with every texture, and small parts never show the extra detail
    fmt = TEXTURES if tex > 512 else TRAFFIC_TEXTURES
    if image_count(geo) > 10: tex //= 2
    subprocess.run(TRANSFORM + ['optimize', geo, out, '--compress', 'draco', '--texture-compress', fmt,
                                '--texture-size', str(tex), '--simplify', 'false'] + keep, check=True, capture_output=True)
    os.remove(geo)
    return tris


def main():
    token = os.environ.get('SKETCHFAB_TOKEN')
    if not token: sys.exit('set SKETCHFAB_TOKEN')
    only = set(sys.argv[1:])
    credits = {}
    for kind in ('vehicles', 'traffic'):
        os.makedirs(os.path.join(ROOT, kind), exist_ok=True)
        path = os.path.join(ROOT, kind, 'credits.json')
        credits[kind] = json.load(open(path)) if os.path.exists(path) else {}
    for vid, (uid, player, traffic) in VEHICLES.items():
        if only and vid not in only: continue
        info = api('models/' + uid)
        lic = (info.get('license') or {}).get('slug') or ''
        if lic not in FREE:
            print(f'{vid}: skipped, licence {lic!r} is not free to redistribute'); continue
        dl = api(f'models/{uid}/download', token)
        credit = {'title': info.get('name'), 'author': (info.get('user') or {}).get('displayName') or (info.get('user') or {}).get('username'),
                  'license': lic, 'source': 'https://sketchfab.com/3d-models/' + uid}
        with tempfile.TemporaryDirectory() as tmp:
            if 'glb' in dl:
                src = os.path.join(tmp, 'model.glb'); fetch(dl['glb']['url'], src)
            else:
                z = os.path.join(tmp, 'model.zip'); fetch(dl['gltf']['url'], z)
                with zipfile.ZipFile(z) as zf: zf.extractall(os.path.join(tmp, 'x'))
                src = next(os.path.join(d, f) for d, _, fs in os.walk(os.path.join(tmp, 'x')) for f in fs if f.endswith('.gltf'))
            raw = os.path.join(tmp, 'raw.glb')
            subprocess.run(TRANSFORM + ['copy', src, raw], check=True, capture_output=True)
            # three.js no longer renders the old spec/gloss workflow some uploads use: convert to metal/rough
            subprocess.run(TRANSFORM + ['metalrough', raw, raw], check=True, capture_output=True)
            # many exports are triangle soup (no shared vertices): the simplifier then sees every edge as a border it
            # must keep and can't reduce anything, so weld identical vertices first
            subprocess.run(TRANSFORM + ['weld', raw, raw], check=True, capture_output=True)
            node_tools()  # SketchUp-style edge lines: never drawn, often most of the file
            subprocess.run(['node', os.path.join(SCRIPTS, 'strip-lines.mjs'), raw, raw], check=True, capture_output=True)
            faces = info.get('faceCount') or 50000
            # distant traffic needs little texture detail: close-ups switch to the 1024 px player model in game
            for kind, budget, tex in (('vehicles', player, 1024), ('traffic', traffic, 512)):
                if os.environ.get('ONLY') and kind != os.environ['ONLY']: continue
                if not budget: continue
                out = os.path.join(ROOT, kind, vid + '.glb')
                tris = optimize(raw, out, faces, budget, tex)
                credits[kind][vid] = credit
                print(f"{kind}/{vid}: {credit['title']} by {credit['author']} ({lic}) -> {os.path.getsize(out) // 1024} KB, {tris} of {faces} triangles")
                with open(os.path.join(ROOT, kind, 'credits.json'), 'w') as f: json.dump(credits[kind], f, indent=1)


if __name__ == '__main__':
    main()
