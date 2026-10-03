// Hand-authored layout of the Hollowmere valley.
// Coordinates are metres; +x east, +z south (three.js default: the camera looks to -z = north).

export const WORLD = {
  size: 1024, // playable square side
  half: 512,
  heightRes: 513, // 2 m spacing
  maskRes: 1024, // 1 m texels
  waterLevel: 3.0,
  farExtent: 6500,
};

export const VILLAGE = { x: 0, z: 0, radius: 78, plateau: 9.6 };

// River: north → south, through a mill pond, out to the south.
// [x, z, halfWidth]
export const RIVER = [
  [-150, -620, 7],
  [-128, -520, 6.5],
  [-102, -430, 6],
  [-55, -335, 6],
  [8, -258, 5.5],
  [52, -206, 5.2],
  [86, -140, 6],
  [96, -72, 6.5],
  [90, -12, 6],
  [97, 52, 7],
  [120, 120, 8],
  [146, 172, 14],
  [150, 205, 18],
  [166, 246, 12],
  [176, 288, 7],
  [160, 345, 6.5],
  [118, 405, 6.5],
  [70, 470, 7],
  [40, 560, 7],
  [20, 640, 7],
];

export const POND = { x: 152, z: 210, rx: 46, rz: 38, rot: 0.35 };

// Paths. kind: road (cart road), street (village), trail (forest footpath)
export const PATHS = [
  {
    id: 'south-road', kind: 'road', width: 4.2,
    pts: [[-34, 600], [-40, 470], [-36, 380], [-22, 290], [-6, 200], [4, 120], [3, 60], [0, 14]],
  },
  {
    id: 'east-street', kind: 'street', width: 3.6,
    pts: [[0, 0], [24, -3], [52, -9], [76, -12], [90, -12], [104, -12], [132, -19], [170, -34], [214, -48], [262, -58]],
  },
  {
    id: 'north-loop', kind: 'trail', width: 2.0,
    pts: [[262, -58], [262, -110], [238, -160], [192, -196], [132, -222], [86, -218], [60, -210], [52, -207], [44, -204], [20, -186], [2, -140], [-8, -96], [-10, -62]],
  },
  {
    id: 'chapel-lane', kind: 'street', width: 3.0,
    pts: [[-10, -62], [-8, -40], [-4, -18], [0, 0]],
  },
  {
    id: 'mill-lane', kind: 'road', width: 3.2,
    pts: [[0, 0], [-26, 6], [-56, 14], [-92, 20], [-122, 21], [-140, 18]],
  },
  {
    id: 'stones-trail', kind: 'trail', width: 1.8,
    pts: [[-140, 18], [-156, -30], [-176, -92], [-198, -148], [-218, -186], [-228, -204]],
  },
  {
    id: 'pond-lane', kind: 'trail', width: 2.4,
    pts: [[6, 14], [26, 34], [52, 76], [78, 128], [96, 168], [104, 196]],
  },
  {
    id: 'glade-trail', kind: 'trail', width: 1.6,
    pts: [[-8, -96], [-34, -128], [-58, -160], [-66, -176]],
  },
];

export const BRIDGES = [
  // Stone arch bridge carrying the east street over the river.
  { id: 'stone', kind: 'stone', a: [78, -12], b: [102, -12], width: 4.4 },
  // Timber footbridge on the north loop.
  { id: 'foot', kind: 'wood', a: [61, -210.5], b: [43, -203.5], width: 2.2 },
];

export const DOCK = { x: 108, z: 199, len: 13, width: 2.4, angle: -0.25 };

export const CLEARINGS = [
  { id: 'meadow', x: 266, z: -62, r: 58, flowers: 1.0 },
  { id: 'stones', x: -228, z: -205, r: 46, flowers: 0.35 },
  { id: 'glade', x: -66, z: -178, r: 26, flowers: 0.5 },
  { id: 'pondside', x: 168, z: 262, r: 70, flowers: 0.7 },
  { id: 'pasture', x: -58, z: 140, r: 85, flowers: 0.45 },
  { id: 'southfield', x: 40, z: 260, r: 80, flowers: 0.6 },
];

// Wheat / tilled fields (rotated rectangles): centre, half size, angle.
export const FIELDS = [
  { x: -82, z: 52, hx: 26, hz: 17, a: 0.12, crop: 'wheat' },
  { x: -104, z: -22, hx: 24, hz: 16, a: -0.1, crop: 'wheat' },
  { x: -44, z: 84, hx: 22, hz: 14, a: 0.2, crop: 'tilled' },
];

export const LANDMARKS = {
  mill: { x: -142, z: 16 },
  chapel: { x: -14, z: -74 },
  stones: { x: -228, z: -205 },
  bigOak: { x: 276, z: -50 },
  well: { x: 0, z: 0 },
};

// Hand-placed houses. rot in radians, w/d footprint (m), floors, roof style.
// roof: 'thatch' | 'slate'; kind: 'cottage' | 'house' | 'long'
export const HOUSES = [
  // around the square
  { x: -17, z: -16, rot: 0.78, w: 7.5, d: 6.0, floors: 2, roof: 'slate', kind: 'house' },
  { x: 18, z: -17, rot: -0.72, w: 8.0, d: 6.2, floors: 2, roof: 'slate', kind: 'house' },
  { x: -21, z: 15, rot: 2.32, w: 7.0, d: 5.6, floors: 1, roof: 'thatch', kind: 'cottage' },
  { x: 20, z: 16, rot: -2.36, w: 9.0, d: 6.0, floors: 2, roof: 'slate', kind: 'long' },
  // east street
  { x: 40, z: -19, rot: -0.05, w: 6.5, d: 5.4, floors: 1, roof: 'thatch', kind: 'cottage' },
  { x: 44, z: 6, rot: 3.08, w: 7.6, d: 5.8, floors: 2, roof: 'slate', kind: 'house' },
  { x: 62, z: -24, rot: 0.08, w: 6.0, d: 5.0, floors: 1, roof: 'thatch', kind: 'cottage' },
  // west lane
  { x: -40, z: -4, rot: 1.48, w: 7.2, d: 5.6, floors: 1, roof: 'thatch', kind: 'cottage' },
  { x: -46, z: 30, rot: -1.62, w: 8.6, d: 6.0, floors: 2, roof: 'slate', kind: 'house' },
  { x: -72, z: 3, rot: 1.4, w: 6.4, d: 5.2, floors: 1, roof: 'thatch', kind: 'cottage' },
  // south road
  { x: -16, z: 46, rot: 1.62, w: 7.0, d: 5.4, floors: 1, roof: 'thatch', kind: 'cottage' },
  { x: 20, z: 52, rot: -1.5, w: 7.8, d: 5.8, floors: 2, roof: 'slate', kind: 'house' },
  { x: -14, z: 82, rot: 1.5, w: 6.2, d: 5.0, floors: 1, roof: 'thatch', kind: 'cottage' },
  // north lane
  { x: 12, z: -44, rot: -1.6, w: 6.8, d: 5.4, floors: 1, roof: 'thatch', kind: 'cottage' },
  { x: -30, z: -42, rot: 1.2, w: 7.4, d: 5.6, floors: 2, roof: 'slate', kind: 'house' },
];

// Points of interest used by the cinematic tour and villagers' idle spots.
export const TOUR = [
  // [camPos(x,y,z), lookAt(x,y,z)]
  { p: [140, 24, 90], t: [-40, 14, -30] },
  { p: [170, 30, 150], t: [10, 10, -10] },
  { p: [110, 16, 40], t: [0, 12, -20] },
  { p: [60, 12, -2], t: [-10, 10, -10] },
  { p: [10, 9, 34], t: [-6, 10, -40] },
  { p: [-60, 18, 70], t: [-140, 24, 10] },
  { p: [-150, 40, 110], t: [-60, 10, -40] },
  { p: [-110, 60, -120], t: [80, 10, -60] },
  { p: [80, 34, -160], t: [260, 14, -60] },
  { p: [236, 44, -128], t: [272, 14, -48] },
  { p: [330, 48, 40], t: [100, 10, 0] },
];
