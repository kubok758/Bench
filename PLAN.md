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
