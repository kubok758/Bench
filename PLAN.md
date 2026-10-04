# Plan: Hollowmere — a handcrafted explorable 3D valley

Scope: single pipeline, ledger at `GATES.md` (repo root)
Depth: tree 3
Mode: solo with a decomposed tree (leaves worked sequentially in one context;
no subagent fan-out was requested, so the "sequential fallback" launch mode is used)

## Contract

- Interfaces: every world system is an ES module exporting `create*(ctx)` that returns
  `{ object3d?, update(dt, t, ctx)?, stats? }`. `ctx` carries `renderer`, `scene`, `camera`,
  `world` (height/mask sampling), `uniforms` (shared shader uniforms), `quality`.
- Shared shading: all world materials are `ShaderMaterial`s built from `src/render/shaders/*`
  and share one uniforms object (`ctx.uniforms`), so a style switch is a uniform update, never a recompile.
- Style contract: `src/render/styles.js` exports 5 style definitions (ids 0..4) that drive
  material shading (`uStyle`), sky, fog, lighting, post chain and quality knobs.
- Test hook: `?test` query exposes `window.__app` with `ready`, `setStyle`, `setView`, `stats()`,
  `frame()`; the verifier in `tools/verify.mjs` only talks to that API and the DOM.
- Toolchain: Node 22, Vite 8, three r186, postprocessing 6.39, n8ao 2; Playwright 1.56 with
  Chromium/SwiftShader for headless verification.
- Deploy: static `dist/` (Vite `base: './'`) published on the `gh-pages` branch → GitHub Pages.

## Current contract inventory

Contract revision: 1.

| ID | Required outcome or constraint | Owner | Observing gate |
|---|---|---|---|
| C1 | Dense forest areas | 1.3 | G4, M1 |
| C2 | Open grassy clearings | 1.2/1.3 | G4, M1 |
| C3 | Small old village, simple stone + wooden houses | 1.4 | G4, M1 |
| C4 | Little paths and bridges | 1.2/1.4 | G4, M1 |
| C5 | Hills / light mountains in the distance | 1.2 | G4, M1 |
| C6 | Clean sky, nice clouds, atmospheric depth | 1.2 | M1 |
| C7 | Subtle natural water | 1.2 | G4, M1 |
| C8 | A few humans walking naturally on village streets and paths, not placeholders | 1.5 | G5, M4 |
| C9 | Smooth free-camera / exploration controls | 1.1 | G6 |
| C10 | Keys 1–5 switch realistic / Arcane-painterly / anime / cartoon / AAA-ultra | 1.6 | G3 |
| C11 | Each mode transforms the visual language, not a tint | 1.6 | G3, M1 |
| C12 | Same world identity across modes | 1.6 | G3, M1 |
| C13 | Minimal UI | 1.1 | G8 |
| C14 | Wind and subtle motion everywhere | 1.3/1.5 | G5, M1 |
| C15 | Excellent performance | all | G7 |
| C16 | No obvious tiling, dead areas, cheap scattering, flat lighting, generic demo look | all | M1, M3 |
| C17 | Unlazy discipline throughout | root | this file + GATES.md |
| C18 | Repeated visual inspection of every mode + several polish passes | 1.6 | M1, M2 |
| C19 | Live on GitHub Pages, verified working | 1.7 | G9 |
| C20 | Work committed and pushed to `claude/3d-village-explorer-4t3hto` | 1.7 | G10 |

## Tree

- 1 Hollowmere world ............................ GATES.md
  - 1.1 Engine: renderer, shader library, shadows, post chain, controls, UI
  - 1.2 Landscape: terrain + materials, river/pond water, sky + clouds + fog, distant mountains
  - 1.3 Vegetation: trees (LODs, wind), grass field, bushes/ferns/flowers, rocks
  - 1.4 Village: houses, chapel, windmill, bridges, fences, props
  - 1.5 Life: villagers (skinned, procedural walk), birds, smoke, insects, falling leaves
  - 1.6 Styles: five render modes + visual refinement passes
  - 1.7 Ship: build, verification harness, GitHub Pages deploy, live verification

## Status log

- Ledger and plan written before implementation.
- Leaves 1.1–1.5 implemented and rendering (engine, landscape, vegetation, village, villagers, ambient life).
- Inspection round 1 (all five styles, establish + village views) found: villagers read as mannequins up close
  (hair slab, sack disk, pale dyes, boxy torso); Painterly is muddy sepia instead of Arcane-like; Cartoon halftone
  floods everything; Ultra is milkier/flatter than Natural; grass tips too yellow; anime foliage speckled.
- Refinement pass 1 (style language): painterly rebuilt around warm key / cool teal shadows, painted terminator,
  brush modulation, no kernel swirl; cartoon grey-protected saturation + posterise + thicker ink; anime high-noon
  light with diffusion bloom; Ultra moved to golden hour with ray-marched volumetric light and fog banks.
  Measured by `verify.mjs modes`: min structural pair difference 0.135 → 0.251 (tint control 0.005).
- Content pass: forest balance 73% → 57% with 33% open meadows (measured); rocks, standing stones, logs, stumps,
  mushrooms, reeds, lily pads added; villager path graph fully connected (0 unreachable nodes, 12/14 walking).
- Pages pipeline proven early: gh-pages branch push enabled GitHub Pages automatically.
- Refinement pass 2 (density, detail, motion): hedgerows with the odd oak along roads and lanes beyond the
  village, copses in open country; dithered crossfade between tree LODs (no popping); standing stones rebuilt as
  tall tapered menhirs; villager faces get socket and under-nose shading; churchyard wall colliders; adaptive
  quality level (AO off, grass ×0.55) when the resolution floor is not enough. Inspection (pass2 sheets, every
  style): painterly sky and meadows show concentric swirls and square Kuwahara blocks; cartoon mountains and
  square break into camouflage blotches; Ultra valley views are washed out toward the sun; a tree crown fills the
  tour's opening frame.
- Refinement pass 3 (style consistency): polar 8-sector Kuwahara (round strokes); brush strokes from two fixed
  orientations blended by a slow field (the swirls came from rotating absolute screen coordinates); volumetric
  march stops 2 m short of surfaces, uses white-noise jitter (the ordered dither drew diagonal streaks — confirmed
  by toggling it in a diagnostic render) and a realistic haze density (0.004–0.0045 /m instead of 0.012–0.014);
  cartoon posterises value only with soft steps that fade out by 380 m, ground macro variation scaled to 30 %,
  drawn cobbles (grey stones, dark joints) in the cel styles, no violet sky sheen on wet banks; tour start kept
  clear of trees.
- Refinement pass 4 (lighting, readability, people): diagnostic renders toggling one effect at a time traced
  the remaining painterly artefacts — the "rain" streaks were brush strokes multiplied over volumetric haze, the
  beige meadows were the warm rim term at grazing view angles (terrain rim 1.0 → 0.12), the blotches were hard
  light steps on rolling ground (painterly light now lifted and half-quantised, grass blades take the ground's
  light), the dark square was a 31 m tree shadow from a 24° sun (painterly sun → 32°). Ultra: narrower scattering
  lobe (g 0.72) so light gathers into shafts near the sun instead of veiling the valley, sunset sun at 17°,
  exposure 1.3; Anime moved to high noon (58°). Modes gate re-measured: min pair 0.234 → 0.275. Villagers in
  close-up: thicker neck and higher trapezius line, raised collar, slimmer hands, talk gesture at chest height,
  shorter stride and knee bend under long skirts (the swinging shin no longer pierces the skirt).
