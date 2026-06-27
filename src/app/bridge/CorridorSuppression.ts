// Geometric corridor suppression (Option A) — pure math, no engine deps. The flat draped road/area
// the engine projects under one of our raised bridge decks is the "ghost road"; we suppress any
// feature whose geometry lies under a corridor's elevated span. Generic for ANY corridor, no
// per-bridge OSM way-id lists.
//
// Coordinate frames (see worlddrive/research/CoordinateSystems.md):
//  - Worker handler vertices arrive in frame D (flipped tile-local meters, [0, T]).
//  - Corridor centerlines live in frame E (degrees2meters, [X=north, Z=east]) — the car's frame.
//  - tileLocalToWorldMercator() converts D -> E so the two are comparable.
//
// Unit-tested in CorridorSuppression.test.ts.

import {BridgeCorridor, projectPointToPolyline} from "./BridgeDeck";
import {GOLDEN_GATE_CORRIDOR} from "./corridors/GoldenGate";
import {BAY_BRIDGE_CORRIDOR} from "./corridors/BayBridge";

// Web-mercator world constants (must match the provider's tile transforms + MathUtils.degrees2meters).
const WORLD_SIZE = 40075016.68;      // full web-mercator extent in meters
const HALF_WORLD = WORLD_SIZE / 2;   // = R, the degrees2meters half-range (±R, centered at 0)

/**
 * Convert a worker handler vertex — frame D (flipped tile-local meters) — into the corridor/car
 * frame E (degrees2meters, [X=north, Z=east]). Derived and verified in CoordinateSystems.md §3:
 *
 *   X = hx + R − T·(ytile + 1)
 *   Z = hy + T·xtile − R          with T = WORLD_SIZE / 2^zoom, R = WORLD_SIZE / 2
 *
 * `hx, hy` are the post-flip vertex .x / .y; `(xtile, ytile, zoom)` is the tile index.
 */
export function tileLocalToWorldMercator(
	hx: number,
	hy: number,
	xtile: number,
	ytile: number,
	zoom: number
): [number, number] {
	const tileSize = WORLD_SIZE / Math.pow(2, zoom);
	const x = hx + HALF_WORLD - tileSize * (ytile + 1);
	const z = hy + tileSize * xtile - HALF_WORLD;
	return [x, z];
}

// Cheap axis-aligned bounding box per corridor (centerline extent grown by halfWidth), memoized.
// The vast majority of a tile's features are nowhere near a corridor, so this lets isUnderElevatedSpan
// reject them with four comparisons instead of a full polyline projection — important since the test
// runs per-vertex, per-feature, in the tile worker.
interface CorridorBounds {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
}

const boundsCache = new Map<BridgeCorridor, CorridorBounds>();

function corridorBounds(corridor: BridgeCorridor): CorridorBounds {
	let bounds = boundsCache.get(corridor);

	if (!bounds) {
		let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

		for (const [x, z] of corridor.centerline) {
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (z < minZ) minZ = z;
			if (z > maxZ) maxZ = z;
		}

		const m = corridor.halfWidth;
		bounds = {minX: minX - m, maxX: maxX + m, minZ: minZ - m, maxZ: maxZ + m};
		boundsCache.set(corridor, bounds);
	}

	return bounds;
}

/**
 * True when world point (x, z) [frame E] lies under a corridor's flat ELEVATED span — within
 * `halfWidth` of the centerline AND with arc-length inside [spanStart, spanEnd]. Only the flat
 * elevated section qualifies: the ramps (where the deck blends down to the ground) are deliberately
 * excluded so suppressing the flat road there can't leave a hole. A corridor without a declared span
 * never matches (we only remove the ghost where a genuine elevated deck replaces it).
 */
export function isUnderElevatedSpan(x: number, z: number, corridor: BridgeCorridor): boolean {
	if (corridor.centerline.length < 2) {
		return false;
	}
	if (corridor.spanStart === undefined || corridor.spanEnd === undefined) {
		return false;
	}

	const b = corridorBounds(corridor);
	if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) {
		return false;
	}

	const {s, lateral} = projectPointToPolyline(corridor.centerline, x, z);
	return lateral <= corridor.halfWidth && s >= corridor.spanStart && s <= corridor.spanEnd;
}

/**
 * The corridors the tile worker suppresses under. Static, code-default geometry: the worker runs in
 * a separate thread and can't read the live main-thread BridgeRegistry, so it uses the same corridor
 * module consts the registry is seeded from (see CoordinateSystems.md §4). Live panel tuning of a
 * deck's shape therefore doesn't move suppression — acceptable, and re-derivable later if needed.
 */
export const SUPPRESSION_CORRIDORS: readonly BridgeCorridor[] = [
	GOLDEN_GATE_CORRIDOR,
	BAY_BRIDGE_CORRIDOR,
];

/** True when (x, z) [frame E] is under ANY suppression corridor's elevated span. */
export function isUnderAnyCorridorSpan(
	x: number,
	z: number,
	corridors: readonly BridgeCorridor[] = SUPPRESSION_CORRIDORS
): boolean {
	for (const corridor of corridors) {
		if (isUnderElevatedSpan(x, z, corridor)) {
			return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------------------------------
// Handler-facing layer: the tile worker holds geometry in frame D (flipped tile-local meters) and
// knows its tile index (xtile, ytile, zoom) — see Tile3DFromVectorProvider.setTileCoords. These
// functions convert a feature's D vertices to frame E and decide whether the whole feature should be
// suppressed. Structural TileVertex so both Vec2 and VectorNode satisfy it without importing either.

export interface TileVertex {
	readonly x: number;
	readonly y: number;
}

/** Convert an array of frame-D tile vertices to frame-E [X=north, Z=east] world points. */
export function tileVerticesToWorldMercator(
	vertices: readonly TileVertex[],
	xtile: number,
	ytile: number,
	zoom: number
): [number, number][] {
	return vertices.map(v => tileLocalToWorldMercator(v.x, v.y, xtile, ytile, zoom));
}

/** Fraction (0..1) of the given frame-D vertices that lie under any corridor's elevated span. */
export function fractionUnderAnyCorridorSpan(
	vertices: readonly TileVertex[],
	xtile: number,
	ytile: number,
	zoom: number,
	corridors: readonly BridgeCorridor[] = SUPPRESSION_CORRIDORS
): number {
	if (vertices.length === 0) {
		return 0;
	}

	let under = 0;

	for (const v of vertices) {
		const [x, z] = tileLocalToWorldMercator(v.x, v.y, xtile, ytile, zoom);

		if (isUnderAnyCorridorSpan(x, z, corridors)) {
			under++;
		}
	}

	return under / vertices.length;
}

/**
 * Majority rule for a polyline (draped road): suppress when at least half its vertices lie under a
 * corridor's elevated span. A long approach road that only clips the span at one end keeps most of
 * its length on the ground, so it stays below 0.5 and survives. Needs ≥2 vertices to be a path.
 */
export function isTilePathUnderCorridorSpan(
	vertices: readonly TileVertex[],
	xtile: number,
	ytile: number,
	zoom: number,
	corridors: readonly BridgeCorridor[] = SUPPRESSION_CORRIDORS
): boolean {
	if (vertices.length < 2) {
		return false;
	}

	return fractionUnderAnyCorridorSpan(vertices, xtile, ytile, zoom, corridors) >= 0.5;
}

/**
 * Centroid rule for an area (draped surface polygon): suppress when the polygon's vertex centroid
 * lies under a corridor's elevated span. The bridge pavement footprint is compact, so its centroid
 * is a robust single-point test; a large polygon (water, parkland) that only overlaps the span at
 * an edge keeps its centroid outside and survives. Caller passes the OUTER ring vertices only.
 */
export function isTileAreaUnderCorridorSpan(
	ringVertices: readonly TileVertex[],
	xtile: number,
	ytile: number,
	zoom: number,
	corridors: readonly BridgeCorridor[] = SUPPRESSION_CORRIDORS
): boolean {
	if (ringVertices.length === 0) {
		return false;
	}

	let sx = 0, sy = 0;

	for (const v of ringVertices) {
		sx += v.x;
		sy += v.y;
	}

	const [x, z] = tileLocalToWorldMercator(sx / ringVertices.length, sy / ringVertices.length, xtile, ytile, zoom);

	return isUnderAnyCorridorSpan(x, z, corridors);
}
