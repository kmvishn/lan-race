# LAN Racer 3D

A multiplayer browser racing game for local networks. A small Go server hosts the game; players join from any browser on the same network.

## Run

```
go build -o lan-racer . && ./lan-racer
```

Or use `./start.sh` (builds if needed, starts the server in the background and opens the game) and `./stop.sh` to shut it down.

Open `http://localhost:8080` on the host machine; other players use one of the LAN addresses the server prints. All assets are bundled, so no internet connection is needed.

## Maps

Real roads built from OpenStreetMap routes (sprint from start to finish, two-way traffic), plus one street circuit:

Bengaluru (Tin Factory → Brigade Senate 2) · Chennai · Mysuru · Wayanad ghat · Kannur → Thalassery · Ernakulam · Thiruvananthapuram · Hyderabad · Neon Harbor (Tokyo) circuit

- Real elevation from SRTM data: roads climb and dip, and the surrounding terrain follows the hills. The Wayanad ghat keeps all its real hairpins on a two-lane road; its climb (about 700 m in reality) is exaggerated 1.8x for drama.
- Real landmarks along each route from OpenStreetMap/Wikidata, with roadside boards showing their photos from Wikimedia Commons.
- Local traffic per city: two-wheelers, autos, cars, lorries and city buses in regional liveries (BMTC, KSRTC, MTC, TGSRTC and private operators). Liveries are recreated in colour and lettering only; official emblems are not included.
- Traffic is a deterministic driving simulation (same for every player): vehicles keep safe gaps, slow for bends, crawl uphill when heavy, overtake, filter between lanes and stop at bus stops. The vehicle mix per city follows published road counts and registration shares (e.g. Bengaluru ~70% two-wheelers).
- Mass-based collisions: hitting an auto or scooter sends it flying, while buses and lorries barely move.
- The lobby shows a route map with landmarks and an elevation profile for every map.

## Vehicles

Players pick from Indian cars and two-wheelers, budget to luxury: Maruti Swift / Dzire / Baleno, Tata Punch, Honda City, Hyundai Creta, Kia Seltos, Mahindra XUV 3XO / Thar / Scorpio, Hindustan Ambassador, BMW 3 Series, Audi A4 / Q7, Mercedes C-Class, Honda Activa, a 125cc scooter, Bajaj Pulsar 150, TVS Apache RTR 180, Yamaha FZ, Yamaha RX100, KTM Duke and Kawasaki Ninja. Each uses its real top speed and acceleration (reached in 80% of the real time). Bikes lean into corners and have a rider. Police drive an Indian police jeep. Traffic uses real models too, weighted by Indian sales figures and by location: autos, KSRTC and Malabar private buses, Ashok Leyland and city buses, Tata Ace / Eicher / Tata lorries, tractors around Mysuru, jeeps and lorries on the Wayanad ghat, Ambassadors in Kerala, Ola EV and delivery scooters in Bengaluru.

The models are CC-BY licensed from Sketchfab and are downloaded with `SKETCHFAB_TOKEN=<your API token> python3 scripts/fetch-vehicles.py` (needs Node for gltf-transform; with KTX-Software's `toktx` on PATH, player vehicles get GPU-compressed KTX2 textures — only needed when preparing models, never by players). Their authors are listed in `static/models/*/credits.json` and in the game menu. Until they are downloaded the game falls back to the bundled cars.

`scripts/make-maps.py` regenerates the map files (`--pois` refreshes only landmarks/photos), `scripts/make-font.sh` the sign fonts, `scripts/fetch-vendor.sh` the third-party assets.

## Controls

W/↑ throttle · S/↓ brake · A D/← → steer · Space handbrake · Shift/N boost · C camera · R reset · K rain · M mute. Gamepads supported.

## Credits

- Road geometry © OpenStreetMap contributors (ODbL), routed with OSRM
- Elevation: SRTM (NASA/USGS, public domain) via OpenTopoData
- Landmark data: Wikidata (CC0); landmark photos from Wikimedia Commons under CC/PD licences, listed with authors in PHOTO_CREDITS.md
- Ferrari 458 Italia model by vicent091036 — CC-BY 4.0 (via three.js examples)
- Concept car by Eric Chadwick / Darmstadt Graphics Group — CC-BY 4.0 (Khronos glTF Sample Assets)
- Traffic vehicles: Kenney Car Kit — CC0
- Engine loops by domasx2, sirens by aquinn, impacts by rubberduck — CC0; tire squeal by qubodup — CC-BY 3.0 (OpenGameArt)
- Noto Sans CJK / Kannada / Tamil / Malayalam / Telugu (subsets) — SIL Open Font License 1.1
- Lobby song vocal: rendered offline with Piper TTS using the LJSpeech voice (public-domain dataset), pitched onto the melody with the WORLD vocoder (`scripts/make-vocals.py`)
- three.js r160 — MIT
