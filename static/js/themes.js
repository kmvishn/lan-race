// City themes. Fractions (0..1) are positions along the real route from start to finish.
export const FONTS = {
  jp: '"NeonJP", "Noto Sans CJK JP", "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif',
  kn: '"NeonKN", "Noto Sans Kannada", "Tunga", sans-serif',
  ta: '"NeonTA", "Noto Sans Tamil", "Latha", sans-serif',
  ml: '"NeonML", "Noto Sans Malayalam", "Kartika", sans-serif',
  te: '"NeonTE", "Noto Sans Telugu", "Gautami", sans-serif',
};

// Bilingual shop boards: [regional, English].
export const BOARDS = {
  kn: [['ದರ್ಶಿನಿ', 'DARSHINI'], ['ಬೇಕರಿ', 'BAKERY'], ['ಮೆಡಿಕಲ್ಸ್', 'MEDICALS'], ['ಮೊಬೈಲ್', 'MOBILES'], ['ಹೋಟೆಲ್', 'HOTEL'],
    ['ಬಿರಿಯಾನಿ', 'BIRYANI'], ['ಜ್ಯೂಸ್', 'JUICE CENTRE'], ['ಸ್ವೀಟ್ಸ್', 'SWEETS'], ['ಕಾಫಿ', 'FILTER COFFEE'], ['ದೋಸೆ', 'DOSA CORNER'], ['ಬಟ್ಟೆ', 'TEXTILES']],
  ta: [['உணவகம்', 'RESTAURANT'], ['தேநீர் கடை', 'TEA STALL'], ['பேக்கரி', 'BAKERY'], ['மருந்தகம்', 'PHARMACY'], ['மொபைல்', 'MOBILES'],
    ['பிரியாணி', 'BIRYANI'], ['ஜவுளி', 'TEXTILES'], ['இனிப்பு', 'SWEETS'], ['காபி', 'FILTER COFFEE']],
  ml: [['ചായക്കട', 'TEA SHOP'], ['ഹോട്ടൽ', 'HOTEL'], ['ബേക്കറി', 'BAKERY'], ['മെഡിക്കൽസ്', 'MEDICALS'], ['മൊബൈൽ', 'MOBILES'],
    ['ബിരിയാണി', 'BIRYANI'], ['തുണിക്കട', 'TEXTILES'], ['ജ്യൂസ്', 'JUICE'], ['സ്വീറ്റ്സ്', 'SWEETS']],
  te: [['హోటల్', 'HOTEL'], ['బిర్యానీ', 'BIRYANI'], ['ఇరానీ చాయ్', 'IRANI CHAI'], ['బేకరీ', 'BAKERY'], ['మెడికల్స్', 'MEDICALS'],
    ['మొబైల్', 'MOBILES'], ['స్వీట్స్', 'SWEETS'], ['టీ', 'TEA']],
};
export const WELCOME = { kn: 'ಸ್ವಾಗತ', ta: 'வருக', ml: 'സ്വാഗതം', te: 'స్వాగతం' };

const SODIUM = 0xffb066, LED = 0xdfe8ff;
const INDIA_BASE = {
  road: 'india', wall: 'kerb', facade: 'india', neon: false, lampColors: [SODIUM, SODIUM, LED], lampSpacing: 40,
  tints: [[1, 0.95, 0.85], [1, 0.85, 0.85], [0.85, 1, 0.9], [0.85, 0.92, 1], [1, 0.9, 0.7], [0.95, 0.95, 0.95], [1, 0.8, 0.9]],
  nearH: [7, 24], tall: 0.05, tallH: [40, 90], density: 1, buildRanges: [[0, 1]],
  trees: 'rain', treeDensity: 1, kiosks: true, hoardings: true, tanks: true,
  autoColors: [[0.95, 0.76, 0.05], [0.07, 0.07, 0.07], [0.12, 0.48, 0.23]],
  busColors: [0x2f8f3a, 0x1f5fbf], traffic: { auto: 5, scooter: 5, bus: 2, sedan: 4, suv: 2, hatch: 3, van: 1, truck: 1, delivery: 1 },
  slowLeft: true, ground: '#24221d', sky: 'sodium', bloom: 1,
};

export const THEMES = {
  tokyo: {
    lang: 'jp', road: 'tokyo', wall: 'jersey', facade: 'tokyo', neon: true, lampColors: [LED], lampSpacing: 42,
    nearH: [14, 64], tall: 0.12, tallH: [70, 180], density: 1, buildRanges: [[0, 1]], trees: null, ground: '#16181c',
    sky: 'tokyo', tokyo: true, banner: 'NEON HARBOR GP', traffic: null, slowLeft: false,
  },
  bengaluru: {
    ...INDIA_BASE, lang: 'kn', banner: 'TIN FACTORY', nearH: [9, 30], tall: 0.12, tallH: [45, 110],
    overpasses: [[0.3, 0.2, 10.5], [0.55, -0.1, 11], [0.88, 0.15, 12]],
    // Blue Line (KR Pura-Hebbal, phase 2B): BEML six-car driverless sets, stainless with the line's blue band
    metro: { from: 0.03, to: 0.97, side: -1, color: '#1e63d6', name: 'ನಮ್ಮ ಮೆಟ್ರೋ  NAMMA METRO · BLUE LINE',
      train: { cars: 6, body: '#cfd4d9', bodyLow: '#b3b9bf', brushed: true, bands: [['#1e63d6', 100, 16], ['#1e63d6', 170, 8]], cab: '#d8dce0', label: 'ನಮ್ಮ ಮೆಟ್ರೋ', dest: 'HEBBALA' },
      stations: [['KR PURA', 0.04], ['KASTURI NAGAR', 0.14], ['HORAMAVU', 0.24], ['HRBR LAYOUT', 0.35], ['KALYAN NAGAR', 0.45], ['HBR LAYOUT', 0.55], ['NAGAWARA', 0.66], ['VEERANNAPALYA', 0.76], ['KEMPAPURA', 0.86], ['HEBBAL', 0.95]] },
    landmarks: [{ type: 'gateway', at: 'start', label: 'TIN FACTORY' }, { type: 'techpark', at: 0.68, side: 1, label: 'MANYATA TECH PARK' },
      { type: 'glassTowers', at: 'end', label: 'BRIGADE SENATE 2' }],
    traffic: { auto: 6, scooter: 6, bus: 2, sedan: 4, suv: 3, hatch: 3, van: 1, truck: 1, delivery: 1 },
  },
  chennai: {
    ...INDIA_BASE, lang: 'ta', banner: 'NAPIER BRIDGE', sky: 'coastal', trees: 'mixed', nearH: [7, 22],
    water: { ranges: [[0, 0.55]], dir: 'east', kind: 'sea', beach: 90 },
    autoColors: [[0.95, 0.8, 0.05], [0.08, 0.08, 0.08], [0.1, 0.1, 0.1]], busColors: [0x8a1c1c, 0x1c5aa8],
    landmarks: [{ type: 'bridgeArches', at: 0.035 }, { type: 'lighthouse', at: 0.42, side: 'water' }, { type: 'gateway', at: 'end', label: "ELLIOT'S BEACH" }],
  },
  mysuru: {
    ...INDIA_BASE, lang: 'kn', banner: 'MYSURU DASARA RUN', terrainColors: ['#33391f', '#56482f'], nearH: [6, 16], tall: 0, buildRanges: [[0, 0.5]], trees: 'rain', treeDensity: 1.4,
    landmarks: [{ type: 'palace', at: 'start', side: 1 }, { type: 'gopuram', at: 'end', label: 'CHAMUNDI HILLS' }],
    traffic: { auto: 5, scooter: 5, bus: 2, sedan: 4, suv: 2, hatch: 3, van: 1, truck: 1, delivery: 0 },
  },
  wayanad: {
    ...INDIA_BASE, lang: 'ml', banner: 'THAMARASSERY GHAT', sky: 'hill', buildRanges: [[0, 0.04], [0.97, 1]], nearH: [5, 9], tall: 0,
    trees: 'forest', treeDensity: 2.2, tea: true, shoulder: 'earth', terrainColors: ['#22351c', '#4d4332'], kiosks: false, hoardings: false, lampSpacing: 140, reflectors: true,
    busColors: [0xb3121b, 0xe0e0e0], autoColors: [[0.1, 0.1, 0.1], [0.95, 0.78, 0.05], [0.95, 0.78, 0.05]],
    landmarks: [{ type: 'gateway', at: 'start', label: 'THAMARASSERY GHAT' }, { type: 'viewpoint', at: 'end', label: 'LAKKIDI VIEW POINT' }],
    traffic: { auto: 1, scooter: 2, bus: 3, sedan: 3, suv: 4, hatch: 2, van: 1, truck: 3, delivery: 1 }, hairpins: true,
  },
  kannur: {
    ...INDIA_BASE, lang: 'ml', banner: 'KANNUR', sky: 'coastal', terrainColors: ['#2a3a20', '#4a3e2c'], trees: 'palm', treeDensity: 1.6, nearH: [5, 14], tall: 0, density: 0.7,
    water: { ranges: [[0, 0.07], [0.5, 0.6], [0.92, 1]], dir: 'west', kind: 'sea', beach: 60 },
    busColors: [0xb3121b, 0x1f6fd0, 0xf2a800], autoColors: [[0.08, 0.08, 0.08], [0.95, 0.78, 0.05], [0.95, 0.78, 0.05]],
    landmarks: [{ type: 'fort', at: 0.05, side: 'water', label: 'ST. ANGELO FORT' }, { type: 'fort', at: 'end', side: 'land', label: 'THALASSERY FORT' }],
  },
  kochi: {
    ...INDIA_BASE, lang: 'ml', banner: 'MARINE DRIVE', sky: 'coastal', terrainColors: ['#2a3a20', '#4a3e2c'], trees: 'palm', nearH: [10, 30], tall: 0.1,
    water: { ranges: [[0, 0.12]], dir: 'west', kind: 'backwater', beach: 15 },
    // Alstom Metropolis three-car sets in turquoise / aqua blue
    metro: { from: 0.12, to: 0.98, side: -1, color: '#00a6a6', name: 'കൊച്ചി മെട്രോ  KOCHI METRO',
      train: { cars: 3, body: '#37bccb', bodyLow: '#1f8fa3', bands: [['#eaf6f7', 104, 8]], door: '#e3eff1', cab: '#2fb3c3', cabBands: [['#ffffff', 90, 6]], label: 'കൊച്ചി മെട്രോ  KOCHI METRO', dest: 'ALUVA' },
      stations: [["MAHARAJA'S COLLEGE", 0.15], ['MG ROAD', 0.27], ['TOWN HALL', 0.38], ['KALOOR', 0.49], ['JLN STADIUM', 0.6], ['PALARIVATTOM', 0.72], ['CHANGAMPUZHA PARK', 0.84], ['EDAPALLY', 0.95]] },
    busColors: [0xb3121b, 0x1f6fd0, 0xf2a800], autoColors: [[0.08, 0.08, 0.08], [0.95, 0.78, 0.05], [0.95, 0.78, 0.05]],
    landmarks: [{ type: 'gateway', at: 'start', label: 'MARINE DRIVE' }, { type: 'mall', at: 'end', label: 'EDAPPALLY' }],
  },
  trivandrum: {
    ...INDIA_BASE, lang: 'ml', banner: 'EAST FORT', sky: 'coastal', terrainColors: ['#2a3a20', '#4a3e2c'], trees: 'palm', treeDensity: 1.4, nearH: [6, 18],
    water: { ranges: [[0.84, 1]], dir: 'west', kind: 'sea', beach: 70 },
    busColors: [0xb3121b, 0xf2a800], autoColors: [[0.08, 0.08, 0.08], [0.95, 0.78, 0.05], [0.95, 0.78, 0.05]],
    landmarks: [{ type: 'gopuram', at: 'start', side: -1, label: 'SREE PADMANABHASWAMY' }, { type: 'lighthouse', at: 'end', side: 'water', stripes: true }],
  },
  hyderabad: {
    ...INDIA_BASE, lang: 'te', banner: 'CHARMINAR', nearH: [8, 26], tall: 0.06, trees: 'mixed',
    water: { ranges: [[0.8, 1]], dir: 'west', kind: 'lake', beach: 10 },
    // MGBS-Chikkadpally is the Green Line (JBS-MGBS); Hyundai Rotem three-car sets, stainless with blue/red/green stripes
    metro: { from: 0.28, to: 0.78, side: -1, color: '#22a04a', name: 'హైదరాబాద్ మెట్రో  HYDERABAD METRO · GREEN LINE',
      train: { cars: 3, body: '#d2d6da', bodyLow: '#b5bbc1', brushed: true, bands: [['#1f5fbf', 100, 8], ['#d62828', 110, 6], ['#22a04a', 118, 6]], cab: '#dcdfe2', label: 'HYDERABAD METRO', dest: 'JBS PARADE GROUND' },
      stations: [['MG BUS STATION', 0.3], ['SULTAN BAZAR', 0.45], ['NARAYANGUDA', 0.6], ['CHIKKADPALLY', 0.75]] },
    autoColors: [[0.95, 0.8, 0.05], [0.12, 0.45, 0.2], [0.08, 0.08, 0.08]], busColors: [0x1e8a3a, 0xc82020],
    landmarks: [{ type: 'charminar', at: 'start' }, { type: 'buddha', at: 0.93, side: 'water' },
      // Tank Bund along Hussain Sagar: statues of Telugu luminaries and Kakatiya arch replicas
      { type: 'statueRow', from: 0.82, to: 0.995 }, { type: 'kakatiyaArch', at: 0.825 }, { type: 'kakatiyaArch', at: 0.99 }],
  },
};

// Which lateral side (+1 left / -1 right of travel) faces the theme's water at a given point.
export function waterSideAt(track, dist, dir) {
  const s = track.sample(dist);
  const leftX = s.tz; // left vector = (tz, -tx)
  const east = leftX > 0 ? 1 : -1;
  return dir === 'east' ? east : -east;
}

export function inRanges(f, ranges) {
  for (const [a, b] of ranges) if (f >= a && f <= b) return true;
  return false;
}
