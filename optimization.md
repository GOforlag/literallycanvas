# Snapshot size optimization

## Problem

Drawings get really too big (multi megabyte) when the user draws a lot with e.g.
the pen tool, because they contain a lot of points. We need to optimize this.

## Research findings

### Where the bytes actually go

`LinePath.toJSON` ([shapes.coffee:308-319](src/core/shapes.coffee#L308-L319))
serializes **two** coordinate arrays:

```coffee
pointCoordinatePairs:         ([point.x, point.y] for point in @points)
smoothedPointCoordinatePairs: ([point.x, point.y] for point in @smoothedPoints)
```

`@smoothedPoints` is the b-spline expansion of `@points`. With the default
`order: 3`, `segmentSize = 2^3 = 8`, so **the smoothed array is ~8x the raw
array** — and its values are midpoint averages, so they carry the longest
float literals (`456.78906250000006`).

Measured with the built `lib/js/core/shapes.js`, a 200-point pen stroke:

| part | size | share |
|---|---|---|
| `smoothedPointCoordinatePairs` (1607 pts) | 61.4 KB | **88.7 %** |
| `pointCoordinatePairs` (200 pts) | 7.6 KB | 11.0 % |
| everything else | ~0.3 KB | 0.3 % |

**~89 % of a pen-heavy snapshot is data that is fully derivable from the other
11 %.** A 100-stroke drawing measures 5.10 MB, of which the raw points are
0.56 MB. That is the multi-megabyte problem.

### The smoothed points are redundant — verified

`_createLinePathFromData` already handles a missing `smoothedPointCoordinatePairs`:
it passes `smoothedPoints: null`, and the constructor
([shapes.coffee:292-298](src/core/shapes.coffee#L292-L298)) then replays
`addPoint()` over every point — the exact same code path that ran while drawing.

Verified on a 300-point stroke: reconstructing from points only produces a
`smoothedPoints` array that is **bit-identical** to the original (2407 points,
every coordinate equal). Not "close enough" — identical.

```
current:                 103.6 KB
no smoothed:              11.6 KB   (8.9x smaller, lossless)
no smoothed + 2dp round:   4.8 KB   (21.6x smaller, max error 0.005 px)
```

Bonus: when `smooth: false`, `@smoothedPoints` *is* `@points`, so today the
JSON literally contains the same array twice.

### Coordinate precision

`clientCoordsToDrawingCoords` ([LiterallyCanvas.coffee:131](src/core/LiterallyCanvas.coffee#L131))
divides by `backingScale`/`scale`, so points are long floats even from integer
mouse events. Rounding raw points to 2 decimals costs a maximum of **0.005 px**
of deviation in the rendered spline — far below one screen pixel — and cuts the
remaining points array to ~40 %.

### Point capture rate

`Pencil.continue` ([Pencil.coffee:17-23](src/tools/Pencil.coffee#L17-L23))
throttles on time only (`eventTimeThreshold: 10` ms → up to 100 pts/sec). A slow,
careful hand generates hundreds of near-duplicate points. On a simulated
hand-drawn 600-point stroke, Ramer–Douglas–Peucker simplification gives:

| epsilon | points kept |
|---|---|
| 0.25 px | 19 % |
| 0.5 px | 13 % |
| 1 px | 9 % |

### Backward / forward compatibility

- **Old snapshots → new code:** works unchanged. The `smoothedPointCoordinatePairs`
  branch stays in `_createLinePathFromData`.
- **New snapshots → old code:** also works, because the points-only fallback has
  been in `_createLinePathFromData` all along. ⚠️ Worth confirming against the
  literallycanvas version actually deployed in any consumer app before shipping.
- `ErasedLinePath` shares `toJSON`/`constructor` with `LinePath`, so it gets every
  fix for free. `Polygon` already serializes only `pointCoordinatePairs`.
- Also a memory win, not just a bytes-on-the-wire win: `smoothedPoints` is 8N live
  `Point` objects per stroke, retained for every shape and every undo-stack entry.

## Plan

Phased so each step ships independently and the risky/lossy parts come last.

### Phase 1 — Stop serializing smoothed points (lossless, ~9x) — ✅ DONE

Measured result: **5.10 MB → 0.58 MB (8.8x)**, rendered geometry bit-identical,
load time slightly *faster* than before.

Four changes, all in [src/core/shapes.coffee](src/core/shapes.coffee):

1. **`linePathFuncs.toJSON`** — dropped the `smoothedPointCoordinatePairs` key.
   This is the actual size fix. Reading it on load is kept forever, for old
   snapshots.
2. **`_createLinePathFromData`** — `return null unless points[0]` threw when
   `points` was undefined; now tolerates a smoothed-only payload.
3. **`linePathFuncs.move`** — was doing `@points = @smoothedPoints`, which
   discarded the raw points and replaced them with the 8x-larger smoothed array.
   Harmless when smoothed points were stored verbatim, but it would have made a
   moved shape reload as a *re-smoothed* curve, and multiplied its stored point
   count by 8 on every move. Now translates both arrays and leaves `@points` raw.
4. **`addPoint` + `_mid`** — two performance fixes, needed because phase 1 moves
   spline computation to load time (see below).

#### The load-time cost, and what it took to remove it

Reconstruction replays `addPoint` per point. That was fine when it ran once per
mouse event, but running N of them back to back exposed two problems that made
loading 14-29x slower than the old format:

- `addPoint` rebuilt `@smoothedPoints` with `slice().concat()` on every point.
  The array is 8x longer than `@points`, so building a path was **O(n²)** —
  a 3000-point stroke cost 1875 ms. Now truncates in place and pushes: O(n).
- `_mid` created each intermediate spline point via `createShape`, which stamps
  a `util.getGUID()` (8 `Math.random()` calls + string building). The b-spline
  makes **~169 of them per point added**, so GUIDs alone were **85%** of the cost
  of building a path. These points are pure geometry — serialized as bare
  coordinate pairs, never looked up by id — so `_mid` now constructs them
  directly. This speeds up live drawing too, not just loading.

| 20 strokes x 1000 pts | size | load |
|---|---|---|
| old format | 6.72 MB | 89 ms |
| new format, before perf fixes | 0.75 MB | 1634 ms |
| new format, after perf fixes | 0.75 MB | **68 ms** |

#### Verification

19 assertions, all passing: key absent from output; round trip bit-identical
(2407/2407 coordinates equal); old snapshots with smoothed pairs still load and
use them verbatim; smoothed-only data doesn't throw; empty data still returns
null; `smooth: false` round trips; `ErasedLinePath` gets the same fix; point
count stable across repeated `move()`s and moved shapes reload to the same curve.

Geometry was diffed against the pre-change implementation at n = 1, 2, 3, 4, 5,
10, 50, 200, 1000 in both smooth modes: **max difference 0 everywhere.**

`lib/` was rebuilt with `npx gulp commonjs` (the `prepare` script runs it on
install). Every other generated file rebuilt byte-identically, confirming the
toolchain matches the one that produced the committed `lib/`.

### Phase 2 — Round coordinates on serialize (~2.4x more)

Round to 2 decimals in `toJSON` only, leaving live in-memory points at full
precision so drawing fidelity is untouched.

- Apply to `LinePath`/`ErasedLinePath` `pointCoordinatePairs`, and to `Polygon`.
- Make the precision a constant so it can be tuned, and verify max spline
  deviation stays < 0.01 px.

### Phase 3 — Fewer points at the source (~5-10x more, lossy)

Two independent levers; do the cheap one first and re-measure before deciding
whether the second is needed.

1. **Minimum-distance filter in `Pencil.continue`** — skip points closer than
   ~1 px (in drawing coordinates, so it scales with zoom) to the previous point.
   Cheap, no new algorithm, also speeds up live rendering.
2. **RDP simplification on stroke end** — simplify `@points` in `Pencil.end`
   before `lc.saveShape`, then rebuild `smoothedPoints`. Bigger win, but it
   changes the committed shape, so it needs an opt-out.

Both are lossy and change rendered output, so they belong behind options
(`defaultStrokeWidth` sits in `src/core/defaultOptions.jsx` — add alongside it)
with the current behaviour available.

### Expected outcome

| stage | 100-stroke drawing | |
|---|---|---|
| today | 5.10 MB | |
| after phase 1 | **0.58 MB** | ✅ measured |
| after phase 2 | ~0.24 MB | projected |
| after phase 3 | ~0.03-0.05 MB | projected |

### Open questions

1. ~~Which literallycanvas version do the consuming apps run?~~ Tested directly:
   the pre-change code reads the new format and produces bit-identical geometry.
   Still worth a spot check if a consumer pins a much older release, since the
   points-only fallback is what's being relied on.
2. Are snapshots stored anywhere that needs a migration, or is read-compat enough?
   Nothing needs rewriting — old snapshots keep working as-is, and shrink the
   next time they're saved.
3. Is any visible smoothing change acceptable at all (gates phase 3), or must
   output stay pixel-identical (stop after phase 2, still ~21x)?

### Not worth doing

- Compressing the JSON blob at the storage layer instead — helps, but leaves the
  in-memory 8x blowup and the redundancy in place; orthogonal, can be added later.
- A binary/typed-array encoding — large change to the snapshot contract for less
  gain than simply not storing derivable data.
