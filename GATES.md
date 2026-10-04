# Gates: Hollowmere — explorable 3D valley with five render styles

OWNS: index.html, src/**, public/**, tools/**, package.json, package-lock.json, vite.config.js, README.md, PLAN.md, GATES.md, docs/**

Scope: a polished real-time 3D nature valley with a village, forest, water, distant mountains, walking villagers, smooth exploration controls and five keyboard-switchable render styles, published and verified on GitHub Pages.

- [x] G0: this ledger states outcomes that can fail
  CHECK: node "$UNLAZY_DIR/scripts/gate-lint.mjs" GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=048474c2c2896ae93912c13fb0505ecbcf0c8661a080a7211491fd7c0ba57fb2; exit=0; EXPECT=matched; output-sha256=aa1280c6ace8ecb70a706a30e1cfe363131d8f64fb274bfaf9b8ab250ce33267; output-bytes=504; shell=/bin/sh; cwd=/home/user/Bench; path=7f4fb4b02918/15 entries

- [x] G1: the production bundle builds from a clean install
  CHECK: npm run build
  EXPECT: /built in \d/
  EVIDENCE: automatic-evidence=v1; definition-sha256=2666d2fcddf08153c599b140bfa7d01f52352191d211bd4851a6f461f7d2a313; exit=0; EXPECT=matched; output-sha256=3596e6853a2e0a2de1ee71bb4230f330e3b287a7fe09f37d9a1b5f30f43bd340; output-bytes=431; shell=/bin/sh; cwd=/home/user/Bench; path=7f4fb4b02918/15 entries

- [x] G2: the built site boots to a rendered world with zero page errors and zero console errors
  CHECK: node tools/verify.mjs smoke
  EXPECT: SMOKE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=73ddbf57c22a00dc88957b0d30e662059f6e2de6441a3a8c7db2e03ff5896332; exit=0; EXPECT=matched; output-sha256=e97ce15bea2a46a22c059463f1871037e263043e2cbafe8de3b3df6d742abb08; output-bytes=153; shell=/bin/sh; cwd=/home/user/Bench; path=7f4fb4b02918/15 entries

- [x] G3: keys 1-5 select five styles whose frames differ structurally from each other, beyond what a colour tint can explain
  CHECK: node tools/verify.mjs modes
  EXPECT: MODES OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=e84af7f8735d63538775911d7bc6e18f432db310594bd8e3ca86cce40cc1dd2e; exit=0; EXPECT=matched; output-sha256=301a2e29ebf5007246e7bae26715fc81af1e3932a369fa232bb14686cc111e44; output-bytes=148; shell=/bin/sh; cwd=/home/user/Bench; path=7f4fb4b02918/15 entries

- [x] G4: the measured scene inventory contains forest, clearings, village houses, bridges, paths, water, distant mountains and villagers
  CHECK: node tools/verify.mjs content
  EXPECT: CONTENT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=4889857fac655637669db85935847ca55016f0eed96c7657b63defa0511789d6; exit=0; EXPECT=matched; output-sha256=09fd13a2ce0a8dbbaeb7e8dcd0368496113c7c7bdee56fdd2a81493baf5d86b2; output-bytes=629; shell=/bin/sh; cwd=/home/user/Bench; path=7f4fb4b02918/15 entries

- [x] G5: villagers walk (positions and limb poses change over time) and the environment animates (wind time, windmill, birds, smoke)
  CHECK: node tools/verify.mjs life
  EXPECT: LIFE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=fa31aaa713448657978c63b9f80cbea5e663cd592e76a67491a81cbbff33c075; exit=0; EXPECT=matched; output-sha256=f43caecab39eb06b36c86b8048b4ae3435a49350e323eeb8238c95694bd7c27c; output-bytes=96; shell=/bin/sh; cwd=/home/user/Bench; path=7f4fb4b02918/15 entries

- [x] G6: exploration controls move and turn the camera smoothly, keep it above ground, and toggle fly mode
  CHECK: node tools/verify.mjs controls
  EXPECT: CONTROLS OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=d776a8006e0f5f0c266b338f78dcbae663c462a11e75c26d8bc3758dcea55de0; exit=0; EXPECT=matched; output-sha256=3ddf058848d42bb90205801daea6d086d8f890a19db719166994336422897820; output-bytes=154; shell=/bin/sh; cwd=/home/user/Bench; path=7f4fb4b02918/15 entries

- [x] G7: every style stays inside its draw-call and triangle budget at three reference views, and adaptive resolution reacts to slow frames
  CHECK: node tools/verify.mjs perf
  EXPECT: PERF OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=94533161eb32097431ba330f2e303de5cf7c8d7e83a0ba6630bffb7ad712d1ed; exit=0; EXPECT=matched; output-sha256=709f0eb3ad27c246ba14250a93ff38dcf7488ddbf4572a2a501a9645f851507f; output-bytes=1082; shell=/bin/sh; cwd=/home/user/Bench; path=7f4fb4b02918/15 entries

- [ ] G8: the UI stays minimal: on desktop no touch controls appear and the visible UI while exploring stays under 80 characters and 5% of the screen; on an emulated phone the touch controls cover at most 12% of the screen, stay inside the viewport and do not overlap each other
  CHECK: node tools/verify.mjs ui
  EXPECT: UI OK
  EVIDENCE: pending

- [x] G9: the live GitHub Pages site boots to a rendered world with zero errors
  CHECK: node tools/verify.mjs smoke --url https://kubok758.github.io/Bench/
  EXPECT: SMOKE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=ca1ae870a16aedd4a60a636b1bf67e1cfe4afebe54cd9287f33babfaba6f3fa2; exit=0; EXPECT=matched; output-sha256=520e221fa2386e9fb66c172a43a1b94db25a5bc7190ba1d40724c4935c431c5b; output-bytes=153; shell=/bin/sh; cwd=/home/user/Bench; path=7f4fb4b02918/15 entries

- [x] G10: the development branch is committed and pushed with no local drift
  CHECK: node tools/check-git.mjs claude/3d-village-explorer-4t3hto
  EXPECT: GIT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=e7501e1078d117a9c844b4ac1d10f6ec98700b91cca702584b782656a950ebfb; exit=0; EXPECT=matched; output-sha256=5e85b0f0b31d3fb420a31a6a823c42d531669f2a9dd692dde2a3e9cf3c6b9249; output-bytes=42; shell=/bin/sh; cwd=/home/user/Bench; path=7f4fb4b02918/15 entries

- [ ] G11: on an emulated phone (portrait and landscape) the on-screen joystick moves the walker, a look drag turns the camera, both work together with two fingers, touches on buttons neither move nor turn the camera, and on-screen buttons switch all five styles, jump, toggle fly and fly up and down
  CHECK: node tools/verify.mjs touch
  EXPECT: TOUCH OK
  EVIDENCE: pending

- [ ] G12: the fullscreen button enters and leaves fullscreen on desktop and on an emulated phone, and its pressed state follows the browser's fullscreen state (including leaving fullscreen by the browser)
  CHECK: node tools/verify.mjs fullscreen
  EXPECT: FULLSCREEN OK
  EVIDENCE: pending

- [ ] G13: the live GitHub Pages site passes the touch and fullscreen checks
  CHECK: node tools/verify.mjs touch --url https://kubok758.github.io/Bench/ && node tools/verify.mjs fullscreen --url https://kubok758.github.io/Bench/
  EXPECT: FULLSCREEN OK
  EVIDENCE: pending

- [x] M1: every style was inspected from several viewpoints and the weak areas found were fixed
  EVIDENCE: 5 inspection passes over all five styles (valley ×2, standing stones, square, people, ground close-up) logged in PLAN.md with the defect found and the fix; final sheets docs/inspection/final-style-1..5.jpg and post-fix sheets docs/inspection/after-fix-style-2..4.jpg; defects traced with one-effect-at-a-time diagnostic renders (painterly swirls, streaks, beige wash, blotches; cartoon camouflage; ultra veil; sky square).

- [x] M2: at least three refinement passes spent purely on visual quality, density, lighting, animation and style consistency, each logged with concrete changes
  EVIDENCE: PLAN.md status log lists refinement passes 1-5 (style language; density/detail/motion; style consistency; lighting/readability/people; final inspection), each with concrete changes and measured numbers (e.g. modes min pair 0.135 -> 0.251 -> 0.275, 0.259 after the final Ultra haze reduction; forest 73% -> 57% with 33% open).

- [x] M3: ground close-ups show no obvious texture tiling and no empty or dead-looking areas
  EVIDENCE: closeup and square views in docs/inspection/final-style-1..5.jpg: cobbles, path dirt, worn grass and meadow show no repeat pattern (two-sample anti-tiling + macro variation in src/world/terrain.js); measured inventory (verify content): 300k grass blades, 26k flowers, 5.2k ferns, 36k wheat stalks, 937 rocks, 140 logs, 160 stumps, 13,286 trees + 733 bushes, forest 56.5% / open 33.3%.

- [x] M4: villagers read as people (proportions, clothing, hair) with a natural walk, inspected in close-up
  EVIDENCE: people/portrait/vendor close-ups (people views in docs/inspection/final-style-*.jpg) show clothing, hair, kerchiefs, faces with eyes/nose shading; neck, shoulders and hands corrected in pass 4; docs/inspection/walk-cycle.jpg shows 8 frames of a walk with arm swing, hip sway and the skirt following the legs (no shin through the skirt); verify life: 13 of 14 walkers moved and animated in 5 s.

- [ ] M5: the phone layout was inspected in portrait and landscape screenshots in at least two styles: controls are legible, compact, consistent with the visual language and do not hide the scene
  EVIDENCE: pending
