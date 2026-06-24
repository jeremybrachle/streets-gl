import {BridgeCorridor} from "./BridgeDeck";
import {buildDeckRibbon, makeDeckHeightFn, DECK_COLOR, HeightFn} from "./DeckMesh";

// A straight 100m corridor along +x, halfWidth 5.
const STRAIGHT: BridgeCorridor = {
	centerline: [[0, 0], [50, 0], [100, 0]],
	halfWidth: 5,
	deckHeight: 20,
	rampLength: 10,
	maxGrade: 0.5,
};

const flat20 = (): number => 20;

describe("buildDeckRibbon — topology", () => {
	test("two vertices per centerline node, two triangles per segment", () => {
		const m = buildDeckRibbon(STRAIGHT, flat20, [0, 0]);
		// 3 nodes -> 6 vertices (18 position floats); 2 segments -> 4 triangles -> 12 indices.
		expect(m.position.length).toBe(6 * 3);
		expect(m.indices.length).toBe(2 * 2 * 3);
		expect(m.normal.length).toBe(6 * 3);
		expect(m.color.length).toBe(6 * 3);
	});

	test("degenerate corridor (< 2 nodes) yields empty buffers", () => {
		const m = buildDeckRibbon({...STRAIGHT, centerline: [[0, 0]]}, flat20, [0, 0]);
		expect(m.position.length).toBe(0);
		expect(m.indices.length).toBe(0);
	});

	test("indices stay within the vertex range", () => {
		const m = buildDeckRibbon(STRAIGHT, flat20, [0, 0]);
		const vertexCount = m.position.length / 3;
		for (const idx of m.indices) {
			expect(idx).toBeGreaterThanOrEqual(0);
			expect(idx).toBeLessThan(vertexCount);
		}
	});

	test("breaks the ribbon where the height function is null (no deck over land)", () => {
		// STRAIGHT has nodes at x = 0, 50, 100. The middle node has no deck -> it's skipped, leaving
		// two isolated nodes and NO quad (no pair of consecutive deck nodes).
		const gap: HeightFn = (x): number | null => (x === 50 ? null : 20);
		const m = buildDeckRibbon(STRAIGHT, gap, [0, 0]);
		expect(m.position.length).toBe(4 * 3); // nodes 0 and 100 only
		expect(m.indices.length).toBe(0);
	});

	test("emits the deck only up to a trailing gap", () => {
		// Last node has no deck -> one quad between nodes 0 and 1.
		const gap: HeightFn = (x): number | null => (x === 100 ? null : 20);
		const m = buildDeckRibbon(STRAIGHT, gap, [0, 0]);
		expect(m.position.length).toBe(4 * 3); // nodes 0 and 50
		expect(m.indices.length).toBe(6);      // one quad
	});
});

describe("buildDeckRibbon — geometry", () => {
	test("ribs straddle the centerline by halfWidth on a +x corridor", () => {
		const m = buildDeckRibbon(STRAIGHT, flat20, [0, 0]);
		// Node 0 at (0,0): left vertex then right vertex, offset ±5 in z, height 20.
		expect(m.position[0]).toBeCloseTo(0, 6); // x
		expect(m.position[1]).toBeCloseTo(20, 6); // y
		expect(Math.abs(m.position[2])).toBeCloseTo(5, 6); // |z| = halfWidth
		// The two vertices of a rib are on opposite sides.
		expect(Math.sign(m.position[2])).toBe(-Math.sign(m.position[5]));
	});

	test("anchor is subtracted from x/z but not y", () => {
		const at = buildDeckRibbon(STRAIGHT, flat20, [10, 0]);
		const ref = buildDeckRibbon(STRAIGHT, flat20, [0, 0]);
		// Every x shifted by -10, y untouched.
		expect(at.position[0]).toBeCloseTo(ref.position[0] - 10, 6);
		expect(at.position[1]).toBeCloseTo(ref.position[1], 6);
	});

	test("height comes from the height function", () => {
		const ramp = (x: number): number => x * 0.1;
		const m = buildDeckRibbon(STRAIGHT, ramp, [0, 0]);
		// Node 2 is at x=100 -> height 10. Vertices 4 and 5 are that rib.
		expect(m.position[4 * 3 + 1]).toBeCloseTo(10, 6);
		expect(m.position[5 * 3 + 1]).toBeCloseTo(10, 6);
	});

	test("normals point up and color is the deck color", () => {
		const m = buildDeckRibbon(STRAIGHT, flat20, [0, 0]);
		expect([m.normal[0], m.normal[1], m.normal[2]]).toEqual([0, 1, 0]);
		expect([m.color[0], m.color[1], m.color[2]]).toEqual(DECK_COLOR);
	});
});

describe("buildDeckRibbon — UVs", () => {
	test("emits a uv buffer with 2 floats per vertex", () => {
		const m = buildDeckRibbon(STRAIGHT, flat20, [0, 0]);
		// 3 nodes → 6 vertices → 12 UV floats (2 per vertex).
		expect(m.uv.length).toBe(6 * 2);
	});

	test("u=0 at left vertex, u=1 at right vertex for every rib", () => {
		const m = buildDeckRibbon(STRAIGHT, flat20, [0, 0]);
		// Vertices are emitted as left, right pairs. u[0]=0 (left), u[2]=1 (right), etc.
		for (let v = 0; v < 6; v += 2) {
			expect(m.uv[v * 2 + 0]).toBeCloseTo(0, 6);     // left u
			expect(m.uv[(v + 1) * 2 + 0]).toBeCloseTo(1, 6); // right u
		}
	});

	test("v tiles by arc-length / (halfWidth*2) so the texture is roughly square", () => {
		const m = buildDeckRibbon(STRAIGHT, flat20, [0, 0]);
		const tileSize = STRAIGHT.halfWidth * 2; // 10m
		// Node 0 at arc 0 → v=0. Node 1 at arc 50 → v=5. Node 2 at arc 100 → v=10.
		expect(m.uv[0 * 2 + 1]).toBeCloseTo(0, 6);
		expect(m.uv[2 * 2 + 1]).toBeCloseTo(50 / tileSize, 4);
		expect(m.uv[4 * 2 + 1]).toBeCloseTo(100 / tileSize, 4);
	});

	test("degenerate corridor yields empty uv buffer", () => {
		const m = buildDeckRibbon({...STRAIGHT, centerline: [[0, 0]]}, flat20, [0, 0]);
		expect(m.uv.length).toBe(0);
	});

	test("gap node produces no uv entry for skipped vertices", () => {
		const gap: HeightFn = (x): number | null => (x === 50 ? null : 20);
		const m = buildDeckRibbon(STRAIGHT, gap, [0, 0]);
		// Nodes 0 and 2 both present (2 verts each = 4 verts total → 8 UV floats).
		expect(m.uv.length).toBe(4 * 2);
	});
});

describe("makeDeckHeightFn — matches the drivable profile", () => {
	const fn = makeDeckHeightFn(STRAIGHT, 0);

	test("flat at deckHeight on the main span", () => {
		expect(fn(50, 0)).toBeCloseTo(20, 6);
	});

	test("lands at the ground floor at the very ends", () => {
		expect(fn(0, 0)).toBeCloseTo(0, 6);
		expect(fn(100, 0)).toBeCloseTo(0, 6);
	});

	test("ramp height is between floor and deck", () => {
		const h = fn(20, 0);
		expect(h).toBeGreaterThan(0);
		expect(h).toBeLessThan(20);
	});

	test("a ground FUNCTION lands the ramp ends on the sampled terrain (not sea level)", () => {
		// Terrain at a constant 12 along the whole corridor: ramp ends meet 12, span stays at deck.
		const onTerrain = makeDeckHeightFn(STRAIGHT, () => 12);
		expect(onTerrain(0, 0)).toBeCloseTo(12, 6);   // abutment sits on the ground, not at 0
		expect(onTerrain(100, 0)).toBeCloseTo(12, 6);
		expect(onTerrain(50, 0)).toBeCloseTo(20, 6);   // main span still at deck height
	});
});
