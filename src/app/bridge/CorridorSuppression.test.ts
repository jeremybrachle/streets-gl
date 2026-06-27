import MathUtils from "~/lib/math/MathUtils";
import {
	tileLocalToWorldMercator,
	tileVerticesToWorldMercator,
	fractionUnderAnyCorridorSpan,
	isTilePathUnderCorridorSpan,
	isTileAreaUnderCorridorSpan,
	isUnderElevatedSpan,
	isUnderAnyCorridorSpan,
} from "./CorridorSuppression";
import {BridgeCorridor} from "./BridgeDeck";
import {BAY_BRIDGE_CORRIDOR} from "./corridors/BayBridge";
import {GOLDEN_GATE_CORRIDOR} from "./corridors/GoldenGate";

const WORLD_SIZE = 40075016.68;
const ZOOM = 16;

/** degrees2meters as a tuple [X=north, Z=east] (the corridor/car frame E). */
function d2m(lat: number, lon: number): [number, number] {
	const v = MathUtils.degrees2meters(lat, lon);
	return [v.x, v.y];
}

/**
 * Replica of the provider's FORWARD transform (frame E/A -> frame D), so the conversion can be
 * verified as a closed loop. Mirrors Tile3DFromVectorProvider.transformOMBBToWorldSpace: take a
 * lat/lon, find which tile it falls in, and produce the flipped tile-local vertex (hx, hy) the
 * worker handler would see. Returns the vertex plus its tile index.
 */
function latLonToTileLocal(lat: number, lon: number): {
	hx: number;
	hy: number;
	xtile: number;
	ytile: number;
} {
	const tileF = MathUtils.degrees2tile(lat, lon, ZOOM); // fractional tile coords
	const scale = Math.pow(2, ZOOM);
	const u = tileF.x / scale; // normalized east  [0,1]
	const v = tileF.y / scale; // normalized south [0,1]
	const T = WORLD_SIZE / scale;

	const xtile = Math.floor(tileF.x);
	const ytile = Math.floor(tileF.y);

	const gx = u * WORLD_SIZE;
	const gy = v * WORLD_SIZE;

	// un-flipped tile-local meters, then the provider's axis flip
	const localX = gx - T * xtile;
	const localY = gy - T * ytile;
	const hx = T - localY;
	const hy = localX;

	return {hx, hy, xtile, ytile};
}

describe("tileLocalToWorldMercator (frame D -> E)", () => {
	// Closed loop: lat/lon -> provider forward -> our inverse should reproduce degrees2meters.
	const points: [string, number, number][] = [
		["Bay span SF anchorage", 37.78620, -122.39073],
		["Bay span midpoint", 37.79714, -122.37901],
		["Bay span YBI", 37.80808, -122.36729],
		["GGB span midpoint", 37.81995, -122.47855],
		["non-bridge (downtown SF)", 37.79468, -122.39438],
	];

	for (const [name, lat, lon] of points) {
		it(`round-trips ${name}`, () => {
			const {hx, hy, xtile, ytile} = latLonToTileLocal(lat, lon);
			const [x, z] = tileLocalToWorldMercator(hx, hy, xtile, ytile, ZOOM);
			const [ex, ez] = d2m(lat, lon);

			expect(x).toBeCloseTo(ex, 2);
			expect(z).toBeCloseTo(ez, 2);
		});
	}

	it("is consistent across a tile boundary (verifies the ytile+1 term)", () => {
		// The same physical Bay point expressed in tile (ytile) vs the vertically-adjacent tile
		// (ytile-1) must convert to the SAME world point. In the lower tile its local Y is larger by
		// one tile, i.e. hx is smaller by T — exactly the case the ytile+1 term must absorb.
		const {hx, hy, xtile, ytile} = latLonToTileLocal(37.79714, -122.37901);
		const T = WORLD_SIZE / Math.pow(2, ZOOM);

		const fromOwnTile = tileLocalToWorldMercator(hx, hy, xtile, ytile, ZOOM);
		const fromNeighborTile = tileLocalToWorldMercator(hx - T, hy, xtile, ytile - 1, ZOOM);

		expect(fromNeighborTile[0]).toBeCloseTo(fromOwnTile[0], 2);
		expect(fromNeighborTile[1]).toBeCloseTo(fromOwnTile[1], 2);

		const expected = d2m(37.79714, -122.37901);
		expect(fromOwnTile[0]).toBeCloseTo(expected[0], 2);
		expect(fromOwnTile[1]).toBeCloseTo(expected[1], 2);
	});
});

describe("isUnderElevatedSpan (Bay Bridge)", () => {
	// Span endpoints from BayBridge.ts, interpolated like the corridor densifies them.
	const SPAN_SF: [number, number] = [37.78620, -122.39073];
	const SPAN_YBI: [number, number] = [37.80808, -122.36729];
	const spanPoint = (t: number): [number, number] =>
		d2m(SPAN_SF[0] + (SPAN_YBI[0] - SPAN_SF[0]) * t, SPAN_SF[1] + (SPAN_YBI[1] - SPAN_SF[1]) * t);

	it("is TRUE for points on the elevated span (3 along its length)", () => {
		for (const t of [0.3, 0.5, 0.7]) {
			const [x, z] = spanPoint(t);
			expect(isUnderElevatedSpan(x, z, BAY_BRIDGE_CORRIDOR)).toBe(true);
		}
	});

	it("is FALSE beyond halfWidth (100 m off the centerline normal)", () => {
		// Build a true perpendicular offset from a mid-span segment so lateral >> halfWidth (20 m).
		const i = 7; // a span-interior node (SPAN_START_INDEX = 3, then 11 span nodes)
		const a = BAY_BRIDGE_CORRIDOR.centerline[i];
		const b = BAY_BRIDGE_CORRIDOR.centerline[i + 1];
		const dx = b[0] - a[0];
		const dz = b[1] - a[1];
		const len = Math.hypot(dx, dz);
		const nx = -dz / len;
		const nz = dx / len;
		const midX = (a[0] + b[0]) / 2 + nx * 100;
		const midZ = (a[1] + b[1]) / 2 + nz * 100;

		expect(isUnderElevatedSpan(midX, midZ, BAY_BRIDGE_CORRIDOR)).toBe(false);
	});

	it("is FALSE on the land approach (arc-length before spanStart)", () => {
		// APPROACH_SF[0] — on the centerline but before the elevated span begins.
		const [x, z] = d2m(37.78296, -122.39564);
		expect(isUnderElevatedSpan(x, z, BAY_BRIDGE_CORRIDOR)).toBe(false);
	});

	it("is FALSE for a corridor with no declared span", () => {
		const noSpan: BridgeCorridor = {...BAY_BRIDGE_CORRIDOR, spanStart: undefined, spanEnd: undefined};
		const [x, z] = spanPoint(0.5);
		expect(isUnderElevatedSpan(x, z, noSpan)).toBe(false);
	});
});

describe("isUnderAnyCorridorSpan", () => {
	it("matches a Bay Bridge span point", () => {
		const [x, z] = d2m(37.79714, -122.37901);
		expect(isUnderAnyCorridorSpan(x, z)).toBe(true);
	});

	it("matches a Golden Gate span point", () => {
		const mid = GOLDEN_GATE_CORRIDOR.modelAnchor as [number, number]; // span midpoint
		expect(isUnderAnyCorridorSpan(mid[0], mid[1])).toBe(true);
	});

	it("is FALSE far from every corridor", () => {
		expect(isUnderAnyCorridorSpan(0, 0)).toBe(false);
	});
});

// ---------------------------------------------------------------------------------------------------
// Handler-facing layer. These take frame-D vertices (what a worker handler holds) + a SINGLE tile
// index. Frame D is linear, so a point physically in a neighbouring tile is still exactly recoverable
// when expressed in another tile's local frame (it just falls outside [0,T]) — see the cross-boundary
// test above. tileLocalForTile() exploits that to build all of a feature's vertices against one tile.

const ZOOM_HF = ZOOM;

/** Express a lat/lon as a frame-D vertex (hx, hy) relative to an arbitrary chosen tile. */
function tileLocalForTile(lat: number, lon: number, xtile: number, ytile: number): {x: number; y: number} {
	const scale = Math.pow(2, ZOOM_HF);
	const tileF = MathUtils.degrees2tile(lat, lon, ZOOM_HF);
	const u = tileF.x / scale;
	const v = tileF.y / scale;
	const T = WORLD_SIZE / scale;
	const gx = u * WORLD_SIZE;
	const gy = v * WORLD_SIZE;
	const localX = gx - T * xtile;
	const localY = gy - T * ytile;
	return {x: T - localY, y: localX};
}

/** The reference tile we build handler-facing fixtures in: the tile containing the Bay span midpoint. */
const REF_TILE = (() => {
	const t = MathUtils.degrees2tile(37.79714, -122.37901, ZOOM_HF);
	return {xtile: Math.floor(t.x), ytile: Math.floor(t.y)};
})();

// Bay elevated-span endpoints (from BayBridge.ts) and a downtown (off-bridge) reference.
const BAY_SF: [number, number] = [37.78620, -122.39073];
const BAY_YBI: [number, number] = [37.80808, -122.36729];
const DOWNTOWN: [number, number] = [37.79468, -122.39438];

const baySpanLatLon = (t: number): [number, number] =>
	[BAY_SF[0] + (BAY_YBI[0] - BAY_SF[0]) * t, BAY_SF[1] + (BAY_YBI[1] - BAY_SF[1]) * t];

describe("tileVerticesToWorldMercator", () => {
	it("maps each frame-D vertex back to its degrees2meters world point", () => {
		const latLons: [number, number][] = [baySpanLatLon(0.4), baySpanLatLon(0.6), DOWNTOWN];
		const verts = latLons.map(([la, lo]) => tileLocalForTile(la, lo, REF_TILE.xtile, REF_TILE.ytile));

		const out = tileVerticesToWorldMercator(verts, REF_TILE.xtile, REF_TILE.ytile, ZOOM_HF);

		for (let i = 0; i < latLons.length; i++) {
			const [ex, ez] = d2m(latLons[i][0], latLons[i][1]);
			expect(out[i][0]).toBeCloseTo(ex, 2);
			expect(out[i][1]).toBeCloseTo(ez, 2);
		}
	});
});

describe("fractionUnderAnyCorridorSpan", () => {
	it("is 1 when every vertex is under the span", () => {
		const verts = [0.3, 0.5, 0.7].map(t => {
			const [la, lo] = baySpanLatLon(t);
			return tileLocalForTile(la, lo, REF_TILE.xtile, REF_TILE.ytile);
		});

		expect(fractionUnderAnyCorridorSpan(verts, REF_TILE.xtile, REF_TILE.ytile, ZOOM_HF)).toBeCloseTo(1, 5);
	});

	it("is 0 for an all-downtown polyline", () => {
		const verts = [DOWNTOWN, DOWNTOWN, DOWNTOWN].map(([la, lo]) =>
			tileLocalForTile(la, lo, REF_TILE.xtile, REF_TILE.ytile));

		expect(fractionUnderAnyCorridorSpan(verts, REF_TILE.xtile, REF_TILE.ytile, ZOOM_HF)).toBe(0);
	});

	it("is 0 for an empty vertex list", () => {
		expect(fractionUnderAnyCorridorSpan([], REF_TILE.xtile, REF_TILE.ytile, ZOOM_HF)).toBe(0);
	});
});

describe("isTilePathUnderCorridorSpan (majority rule)", () => {
	it("is TRUE for a path running along the elevated span", () => {
		const verts = [0.35, 0.45, 0.55, 0.65].map(t => {
			const [la, lo] = baySpanLatLon(t);
			return tileLocalForTile(la, lo, REF_TILE.xtile, REF_TILE.ytile);
		});

		expect(isTilePathUnderCorridorSpan(verts, REF_TILE.xtile, REF_TILE.ytile, ZOOM_HF)).toBe(true);
	});

	it("is FALSE for an approach road that only clips the span at one end (minority under)", () => {
		// One span vertex + three downtown vertices => 25% under => below the 0.5 majority.
		const verts = [
			tileLocalForTile(...baySpanLatLon(0.5), REF_TILE.xtile, REF_TILE.ytile),
			tileLocalForTile(DOWNTOWN[0], DOWNTOWN[1], REF_TILE.xtile, REF_TILE.ytile),
			tileLocalForTile(DOWNTOWN[0], DOWNTOWN[1], REF_TILE.xtile, REF_TILE.ytile),
			tileLocalForTile(DOWNTOWN[0], DOWNTOWN[1], REF_TILE.xtile, REF_TILE.ytile),
		];

		expect(isTilePathUnderCorridorSpan(verts, REF_TILE.xtile, REF_TILE.ytile, ZOOM_HF)).toBe(false);
	});

	it("is FALSE for a single-vertex degenerate path", () => {
		const v = tileLocalForTile(...baySpanLatLon(0.5), REF_TILE.xtile, REF_TILE.ytile);
		expect(isTilePathUnderCorridorSpan([v], REF_TILE.xtile, REF_TILE.ytile, ZOOM_HF)).toBe(false);
	});
});

describe("isTileAreaUnderCorridorSpan (centroid rule)", () => {
	it("is TRUE for a small footprint centred on the span", () => {
		const [la, lo] = baySpanLatLon(0.5);
		const d = 0.0003; // ~30 m box around the span midpoint
		const ring = [
			tileLocalForTile(la + d, lo + d, REF_TILE.xtile, REF_TILE.ytile),
			tileLocalForTile(la + d, lo - d, REF_TILE.xtile, REF_TILE.ytile),
			tileLocalForTile(la - d, lo - d, REF_TILE.xtile, REF_TILE.ytile),
			tileLocalForTile(la - d, lo + d, REF_TILE.xtile, REF_TILE.ytile),
		];

		expect(isTileAreaUnderCorridorSpan(ring, REF_TILE.xtile, REF_TILE.ytile, ZOOM_HF)).toBe(true);
	});

	it("is FALSE for a polygon whose centroid is downtown even if a corner clips the span", () => {
		const [sx, sz] = baySpanLatLon(0.5);
		const ring = [
			tileLocalForTile(sx, sz, REF_TILE.xtile, REF_TILE.ytile),      // one corner on the span
			tileLocalForTile(DOWNTOWN[0], DOWNTOWN[1], REF_TILE.xtile, REF_TILE.ytile),
			tileLocalForTile(DOWNTOWN[0], DOWNTOWN[1] - 0.001, REF_TILE.xtile, REF_TILE.ytile),
			tileLocalForTile(DOWNTOWN[0] - 0.001, DOWNTOWN[1], REF_TILE.xtile, REF_TILE.ytile),
		];

		expect(isTileAreaUnderCorridorSpan(ring, REF_TILE.xtile, REF_TILE.ytile, ZOOM_HF)).toBe(false);
	});

	it("is FALSE for an empty ring", () => {
		expect(isTileAreaUnderCorridorSpan([], REF_TILE.xtile, REF_TILE.ytile, ZOOM_HF)).toBe(false);
	});
});
