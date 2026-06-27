import MathUtils from "~/lib/math/MathUtils";
import {
	tileLocalToWorldMercator,
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
