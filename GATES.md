# Gates: Hollowmere — explorable 3D valley with five render styles

OWNS: index.html, src/**, public/**, tools/**, package.json, package-lock.json, vite.config.js, README.md, PLAN.md, GATES.md, docs/**

Scope: a polished real-time 3D nature valley with a village, forest, water, distant mountains, walking villagers, smooth exploration controls and five keyboard-switchable render styles, published and verified on GitHub Pages.

- [ ] G0: this ledger states outcomes that can fail
  CHECK: node "$UNLAZY_DIR/scripts/gate-lint.mjs" GATES.md
  EXPECT: LINT OK
  EVIDENCE: pending

- [ ] G1: the production bundle builds from a clean install
  CHECK: npm run build
  EXPECT: /built in \d/
  EVIDENCE: pending

- [ ] G2: the built site boots to a rendered world with zero page errors and zero console errors
  CHECK: node tools/verify.mjs smoke
  EXPECT: SMOKE OK
  EVIDENCE: pending

- [ ] G3: keys 1-5 select five styles whose frames differ structurally from each other, beyond what a colour tint can explain
  CHECK: node tools/verify.mjs modes
  EXPECT: MODES OK
  EVIDENCE: pending

- [ ] G4: the measured scene inventory contains forest, clearings, village houses, bridges, paths, water, distant mountains and villagers
  CHECK: node tools/verify.mjs content
  EXPECT: CONTENT OK
  EVIDENCE: pending

- [ ] G5: villagers walk (positions and limb poses change over time) and the environment animates (wind time, windmill, birds, smoke)
  CHECK: node tools/verify.mjs life
  EXPECT: LIFE OK
  EVIDENCE: pending

- [ ] G6: exploration controls move and turn the camera smoothly, keep it above ground, and toggle fly mode
  CHECK: node tools/verify.mjs controls
  EXPECT: CONTROLS OK
  EVIDENCE: pending

- [ ] G7: every style stays inside its draw-call and triangle budget at three reference views, and adaptive resolution reacts to slow frames
  CHECK: node tools/verify.mjs perf
  EXPECT: PERF OK
  EVIDENCE: pending

- [ ] G8: the UI stays minimal once exploring (little visible text, nothing large covering the view)
  CHECK: node tools/verify.mjs ui
  EXPECT: UI OK
  EVIDENCE: pending

- [ ] G9: the live GitHub Pages site boots to a rendered world with zero errors
  CHECK: node tools/verify.mjs smoke --url https://kubok758.github.io/Bench/
  EXPECT: SMOKE OK
  EVIDENCE: pending

- [ ] G10: the development branch is committed and pushed with no local drift
  CHECK: node tools/check-git.mjs claude/3d-village-explorer-4t3hto
  EXPECT: GIT OK
  EVIDENCE: pending

- [x] M1: every style was inspected from several viewpoints and the weak areas found were fixed
  EVIDENCE: 5 inspection passes over all five styles (valley ×2, standing stones, square, people, ground close-up) logged in PLAN.md with the defect found and the fix; final sheets docs/inspection/final-style-1..5.jpg and post-fix sheets docs/inspection/after-fix-style-2..4.jpg; defects traced with one-effect-at-a-time diagnostic renders (painterly swirls, streaks, beige wash, blotches; cartoon camouflage; ultra veil; sky square).

- [x] M2: at least three refinement passes spent purely on visual quality, density, lighting, animation and style consistency, each logged with concrete changes
  EVIDENCE: PLAN.md status log lists refinement passes 1-5 (style language; density/detail/motion; style consistency; lighting/readability/people; final inspection), each with concrete changes and measured numbers (e.g. modes min pair 0.135 -> 0.251 -> 0.275, 0.259 after the final Ultra haze reduction; forest 73% -> 57% with 33% open).

- [x] M3: ground close-ups show no obvious texture tiling and no empty or dead-looking areas
  EVIDENCE: closeup and square views in docs/inspection/final-style-1..5.jpg: cobbles, path dirt, worn grass and meadow show no repeat pattern (two-sample anti-tiling + macro variation in src/world/terrain.js); measured inventory (verify content): 300k grass blades, 26k flowers, 5.2k ferns, 36k wheat stalks, 937 rocks, 140 logs, 160 stumps, 13,286 trees + 733 bushes, forest 56.5% / open 33.3%.

- [x] M4: villagers read as people (proportions, clothing, hair) with a natural walk, inspected in close-up
  EVIDENCE: people/portrait/vendor close-ups (people views in docs/inspection/final-style-*.jpg) show clothing, hair, kerchiefs, faces with eyes/nose shading; neck, shoulders and hands corrected in pass 4; docs/inspection/walk-cycle.jpg shows 8 frames of a walk with arm swing, hip sway and the skirt following the legs (no shin through the skirt); verify life: 13 of 14 walkers moved and animated in 5 s.
