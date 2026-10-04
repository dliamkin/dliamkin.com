# Token Field - the persistent particle layer

A framework-free 2D-canvas particle engine ("tokens") that lives behind the
entire site, plus a playground page at `/projects/particle-engine` where
visitors drive it directly. No dependencies; engine + formations + director
are plain TypeScript.

## Architecture

```
App.vue
├── ParticleField.vue            ← ONE <canvas>, position:fixed, z-index:0,
│      │                            pointer-events:none. Mounted once, never
│      │                            unmounts on navigation.
│      │  lazy import (post-first-paint, idle)
│      ▼
│   engine/particles/
│   ├── engine.ts        ParticleEngine - physics + rendering, framework-free
│   ├── formations.ts    pure target generators (text/distribution/columns/converge)
│   ├── noise.ts         cheap sin/cos flow field
│   ├── snapshot.ts      static-frame fallback + benchmark gate
│   └── types.ts
│
├── composables/useParticleDirector.ts   ← the ONLY module that decides WHAT
│                                           the field does (routes, sections)
└── .site-content (z-index:1)            ← all routed pages render above the
    └── <router-view/>                      canvas; roots that should reveal it
                                            use transparent backgrounds
```

The engine is dumb: it knows formations, ambient levels, and physics. The
director maps *site state* (route, dominant scroll section) to engine calls.
The playground page takes manual control on its route; the director steps
aside.

**Data layout:** particles live in six `Float32Array`s (x, y, vx, vy, targetX,
targetY) plus `Uint8Array`s for palette/size class - no per-particle objects,
zero allocations inside the frame loop. Particles draw as 1–2px `fillRect`
(not `arc()`, ~4× slower at this count), bucketed by palette color so
`fillStyle` changes 4× per frame, not 3000×.

## The director pattern

Route policy (see `useParticleDirector.ts`):

| Route                        | Mode         | Behavior                                     |
| ---------------------------- | ------------ | -------------------------------------------- |
| `/projects/particle-engine`  | `playground` | ambient 2, dark ground + trails; page drives |
| tool pages (`/projects/<x>`, `meta.recedeField`) | `recede` | ambient 0 **and full pause** (see adaptations) |
| everything else              | `site`       | ambient 1, transparent canvas, storm + section morphs |

Registering a scroll-driven formation for a section is one line:

```ts
const { registerSection } = useParticleDirector();
onMounted(() => cleanups.push(registerSection(el, "distribution")));
// or, for a future Context X-Ray-style project:
// registerSection(el, "columns", { columns: [{ fraction: 0.6, paletteIndex: 1 }, …] })
```

When the element occupies ≥45% visibility the field morphs into the
formation; when it leaves, the field releases back to the storm. Formation
switches are debounced to ≥600ms so fast scrolling doesn't thrash. Currently
wired: the Tail Risk Lab featured row on `/projects` → `distribution` (the
fat-tailed cost curve).

## Fallback rules (non-negotiable)

The loop never starts when any of these hold - instead ~90 simulation steps
run synchronously and one composed frame stays on the canvas as a static
image (`snapshot.ts`):

1. `prefers-reduced-motion: reduce`
2. viewport width < 768px (recruiters open portfolio links on phones; a janky
   field is worse than none)
3. the live 60-frame benchmark after startup averages < 45fps
   (`engine.onBenchmark` → `markStatic()`)

The playground shows a "Full simulation runs on desktop" note in static mode.
Theme toggles and resizes re-compose the static frame.

## Adaptations from the original brief (decisions log)

The brief assumed a dark, single-theme site. This site is dark-by-default
with an explicit light option, has a fully designed opaque hero (poly
triangles + portfolio wall), and opaque section backgrounds. Decisions:

- **Dark ground ships only on the playground.** Site-wide the canvas is
  transparent over the page background, trails disabled (they need an opaque
  fill), additive glow + default palette on dark theme, muted source-over
  inks (`#2E8F6F`/`#2E76B5`/`#5A52B8`/`#8A8778`) at lower alpha on light.
- **The home hero was left untouched** - it already has two animated ideas
  (poly field, portfolio wall), and the brief's own restraint rule ("one idea
  per view") argues against stacking a third. The hero choreography
  (storm 2.2s → "DLIAMKIN" 2.8s → release) runs on the playground instead,
  first visit per session (`sessionStorage: token-field-intro-seen`).
- **"Recede" on tool pages is a full pause, not a dim field.** Tool views
  have opaque backgrounds, so a dimmed running field would be invisible work;
  pausing gives the instruments every frame. To get visible ambient texture
  behind a tool later: make that view's root background transparent and drop
  the `pause()` in `applyPolicy`.
- **Transparent roots so far:** `/projects` and `/evals` (their old
  backgrounds duplicated the body's). Cards/surfaces stay opaque, so body
  text never sits directly on particles anywhere except page headers - at
  0.45–0.55 particle alpha and 1–2px sizes this stays comfortably readable.

## Level 2 seam (WebGL)

The engine's public API - `setFormation` / `setAmbient` / `pause` / `resume`
/ `setPointer` / `setRenderConfig` - is the contract. A future Three.js/TresJS
renderer (instanced geometry, GLSL vertex-shader positions, 300k particles,
UnrealBloom) implements the same interface behind the same director and host;
nothing above `engine.ts` should need to change. Formation generators already
produce plain `Float32Array` targets, which upload directly as attributes.
The `converge` formation exists (used in tests) but is reserved for future
route-transition choreography - deliberately unwired.

## Verifying the persistent-canvas invariant

`[token-field] engine constructed` logs once from the engine constructor. It
must appear **exactly once per session** no matter how much you navigate - a
second log means the canvas remounted and the architecture regressed. The
playground's particle-count slider reallocates the pool in place
(`setParticleCount`) specifically to preserve this invariant.
