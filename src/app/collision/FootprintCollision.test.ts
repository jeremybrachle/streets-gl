import {
	footprintFromBuffer,
	translateAABB,
	circleIntersectsAABB,
	resolveCircleVsAABBs,
	AABB2D,
	convexHull2D,
	polygonAABB,
	footprintHullFromBuffer,
	pointInConvex,
	resolveCircleVsConvex,
	resolveCircleVsPolygons,
	Polygon2D,
} from "./FootprintCollision";

// A small box building: 4 base verts at y=0, 4 top verts at y=10, spanning x[10..20] z[30..50].
const boxBuilding = [
	10, 0, 30, 20, 0, 30, 20, 0, 50, 10, 0, 50, // base
	10, 10, 30, 20, 10, 30, 20, 10, 50, 10, 10, 50, // top
];

describe('footprintFromBuffer', () => {
	it('extracts the XZ footprint over the whole slice', () => {
		const box = footprintFromBuffer(boxBuilding, 0, 8, 1);
		expect(box).toEqual({minX: 10, maxX: 20, minZ: 30, maxZ: 50});
	});

	it('respects vertexOffset/vertexCount (vertices, not floats)', () => {
		// Only the base ring (verts 0..3) — same footprint, exercises the offset math.
		const box = footprintFromBuffer(boxBuilding, 0, 4, 0);
		expect(box).toEqual({minX: 10, maxX: 20, minZ: 30, maxZ: 50});
	});

	it('returns null for a flat (height < minWallHeight) feature — no wall to hit', () => {
		const flat = [0, 5, 0, 4, 5, 0, 4, 5, 4, 0, 5, 4]; // all y=5, height 0
		expect(footprintFromBuffer(flat, 0, 4, 1)).toBeNull();
	});

	it('returns null for an empty slice', () => {
		expect(footprintFromBuffer(boxBuilding, 0, 0, 1)).toBeNull();
	});
});

describe('translateAABB', () => {
	it('offsets the footprint into world space', () => {
		const local: AABB2D = {minX: 1, maxX: 2, minZ: 3, maxZ: 4};
		expect(translateAABB(local, 100, 200)).toEqual({minX: 101, maxX: 102, minZ: 203, maxZ: 204});
	});
});

describe('circleIntersectsAABB', () => {
	const box: AABB2D = {minX: 0, maxX: 10, minZ: 0, maxZ: 10};
	it('detects overlap when the circle pokes a face', () => {
		expect(circleIntersectsAABB(11, 5, 2, box)).toBe(true);
	});
	it('detects no overlap when the circle clears the box', () => {
		expect(circleIntersectsAABB(13, 5, 2, box)).toBe(false);
	});
	it('detects the center inside the box', () => {
		expect(circleIntersectsAABB(5, 5, 1, box)).toBe(true);
	});
});

describe('resolveCircleVsAABBs', () => {
	const box: AABB2D = {minX: 0, maxX: 10, minZ: 0, maxZ: 10};

	it('leaves a circle that clears every box untouched', () => {
		const out = resolveCircleVsAABBs(20, 20, 1, [box]);
		expect(out).toEqual({x: 20, z: 20});
	});

	it('no-ops with an empty box list', () => {
		const out = resolveCircleVsAABBs(5, 5, 1, []);
		expect(out).toEqual({x: 5, z: 5});
	});

	it('pushes a circle straddling the +X face out to exactly radius clearance', () => {
		// Center just inside the right face; should end up radius beyond maxX, Z unchanged (slide).
		const out = resolveCircleVsAABBs(9, 5, 2, [box]);
		expect(out.x).toBeCloseTo(12, 6); // maxX(10) + radius(2)
		expect(out.z).toBeCloseTo(5, 6); // tangential motion preserved
	});

	it('pushes a circle near a face (center outside) straight out along the normal', () => {
		// Center 1 unit past the +X face, radius 2 → overlap depth 1, pushed to x = 12.
		const out = resolveCircleVsAABBs(11, 5, 2, [box]);
		expect(out.x).toBeCloseTo(12, 6);
		expect(out.z).toBeCloseTo(5, 6);
	});

	it('ejects a center DEEP inside along the least-penetration axis', () => {
		// (8,5): nearest face is +X (pen 2). Eject to maxX + radius.
		const out = resolveCircleVsAABBs(8, 5, 1, [box]);
		expect(out.x).toBeCloseTo(11, 6);
		expect(out.z).toBeCloseTo(5, 6);
	});

	it('resolves the overlapped box and ignores distant boxes, ending clear of all', () => {
		const a: AABB2D = {minX: 0, maxX: 10, minZ: 0, maxZ: 10};
		const b: AABB2D = {minX: 20, maxX: 30, minZ: 0, maxZ: 10}; // far enough to fit (gap 10)
		// Overlapping a's +X face; pushed into the gap, clear of BOTH.
		const out = resolveCircleVsAABBs(9, 5, 2, [a, b]);
		expect(circleIntersectsAABB(out.x, out.z, 2 - 1e-6, a)).toBe(false);
		expect(circleIntersectsAABB(out.x, out.z, 2 - 1e-6, b)).toBe(false);
	});
});

describe('convexHull2D', () => {
	it('hulls a square (drops interior points), CCW, 4 corners', () => {
		const hull = convexHull2D([
			{x: 0, z: 0}, {x: 10, z: 0}, {x: 10, z: 10}, {x: 0, z: 10}, {x: 5, z: 5}, // interior
		]);
		expect(hull).toHaveLength(4);
		// Signed area > 0 ⇒ CCW.
		let area = 0;
		for (let i = 0; i < hull.length; i++) {
			const a = hull[i];
			const b = hull[(i + 1) % hull.length];
			area += a.x * b.z - b.x * a.z;
		}
		expect(area).toBeGreaterThan(0);
	});

	it('a diagonal (45°) square hulls to a tight 4-gon, NOT the ballooned AABB', () => {
		// Diamond: a unit square rotated 45°, diagonal 2 → AABB would be 2×2 (area 4) but the true
		// footprint area is 2. The hull keeps the 4 diamond points (tight), proving we beat the AABB.
		const diamond = [{x: 0, z: -1}, {x: 1, z: 0}, {x: 0, z: 1}, {x: -1, z: 0}];
		const hull = convexHull2D(diamond);
		expect(hull).toHaveLength(4);
		const box = polygonAABB(hull);
		expect(box).toEqual({minX: -1, maxX: 1, minZ: -1, maxZ: 1}); // AABB IS 2×2
		// But a point well inside the AABB corner is OUTSIDE the tight diamond → drivable space the
		// AABB wrongly blocked.
		expect(pointInConvex(0.8, 0.8, hull)).toBe(false);
	});

	it('returns [] for fewer than 3 unique points', () => {
		expect(convexHull2D([{x: 0, z: 0}, {x: 1, z: 1}])).toEqual([]);
	});
});

describe('footprintHullFromBuffer', () => {
	it('returns the hull + aabb for a tall building, null for a flat feature', () => {
		const res = footprintHullFromBuffer(boxBuilding, 0, 8, 1);
		expect(res).not.toBeNull();
		expect(res!.aabb).toEqual({minX: 10, maxX: 20, minZ: 30, maxZ: 50});
		expect(res!.polygon.length).toBe(4);

		const flat = [0, 5, 0, 4, 5, 0, 4, 5, 4, 0, 5, 4];
		expect(footprintHullFromBuffer(flat, 0, 4, 1)).toBeNull();
	});
});

describe('pointInConvex', () => {
	const square: Polygon2D = [{x: 0, z: 0}, {x: 10, z: 0}, {x: 10, z: 10}, {x: 0, z: 10}];
	it('is true for an interior point, false for an exterior point', () => {
		expect(pointInConvex(5, 5, square)).toBe(true);
		expect(pointInConvex(15, 5, square)).toBe(false);
	});
});

describe('resolveCircleVsConvex', () => {
	const square: Polygon2D = [{x: 0, z: 0}, {x: 10, z: 0}, {x: 10, z: 10}, {x: 0, z: 10}];

	it('leaves a clear circle untouched', () => {
		expect(resolveCircleVsConvex(20, 5, 1, square)).toEqual({x: 20, z: 5});
	});

	it('pushes a circle overlapping the +X edge out to radius clearance (slide preserves Z)', () => {
		const out = resolveCircleVsConvex(11, 5, 2, square); // 1 past the edge, radius 2
		expect(out.x).toBeCloseTo(12, 6);
		expect(out.z).toBeCloseTo(5, 6);
	});

	it('ejects an interior center through the nearest edge', () => {
		const out = resolveCircleVsConvex(8, 5, 1, square); // nearest edge +X (pen 2)
		expect(out.x).toBeCloseTo(11, 6);
		expect(out.z).toBeCloseTo(5, 6);
	});

	it('does NOT block the slack corner of a diagonal footprint (the AABB bug)', () => {
		const diamond: Polygon2D = [{x: 0, z: -10}, {x: 10, z: 0}, {x: 0, z: 10}, {x: -10, z: 0}];
		// A point near the AABB corner but outside the diamond, small radius → left free to drive.
		const out = resolveCircleVsConvex(8, 8, 0.5, diamond);
		expect(out).toEqual({x: 8, z: 8});
	});
});

describe('resolveCircleVsPolygons', () => {
	it('ends clear of the overlapped polygon, ignoring distant ones', () => {
		const a: Polygon2D = [{x: 0, z: 0}, {x: 10, z: 0}, {x: 10, z: 10}, {x: 0, z: 10}];
		const b: Polygon2D = [{x: 20, z: 0}, {x: 30, z: 0}, {x: 30, z: 10}, {x: 20, z: 10}];
		const out = resolveCircleVsPolygons(9, 5, 2, [a, b]);
		expect(pointInConvex(out.x, out.z, a)).toBe(false);
		expect(out.x).toBeGreaterThanOrEqual(10);
	});
});
