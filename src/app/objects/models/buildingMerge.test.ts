import {convexOverlap, polygonArea, mergeFootprints, FootprintItem} from "./buildingMerge";
import {Polygon2D, polygonAABB} from "~/app/collision/FootprintCollision";

function rect(x0: number, z0: number, x1: number, z1: number): Polygon2D {
	return [{x: x0, z: z0}, {x: x1, z: z0}, {x: x1, z: z1}, {x: x0, z: z1}];
}

function item(id: number, poly: Polygon2D, height: number, baseY = 0): FootprintItem {
	return {id, polygon: poly, aabb: polygonAABB(poly), height, baseY};
}

describe('convexOverlap', () => {
	it('detects overlapping rectangles', () => {
		expect(convexOverlap(rect(0, 0, 10, 10), rect(5, 5, 15, 15))).toBe(true);
	});
	it('detects containment (a part inside the outline)', () => {
		expect(convexOverlap(rect(0, 0, 20, 20), rect(8, 8, 12, 12))).toBe(true);
	});
	it('returns false for separated rectangles', () => {
		expect(convexOverlap(rect(0, 0, 10, 10), rect(20, 20, 30, 30))).toBe(false);
	});
	it('treats merely-touching (shared wall) as NOT overlapping', () => {
		// Two rowhouses sharing the x=10 wall — must stay separate buildings.
		expect(convexOverlap(rect(0, 0, 10, 10), rect(10, 0, 20, 10))).toBe(false);
	});
});

describe('polygonArea', () => {
	it('computes rectangle area regardless of winding', () => {
		expect(polygonArea(rect(0, 0, 10, 4))).toBeCloseTo(40);
	});
});

describe('mergeFootprints', () => {
	it('merges an outline + an overlapping tower part into one footprint', () => {
		// The Ferry Building case: a big low terminal + a small tall tower sitting on it.
		const terminal = item(1, rect(0, 0, 100, 20), 12);   // area 2000, height 12
		const tower = item(2, rect(45, 8, 55, 12), 60);      // area 40, height 60, overlaps terminal
		const merged = mergeFootprints([terminal, tower]);
		expect(merged).toHaveLength(1);
		expect(merged[0].ids.sort()).toEqual([1, 2]);
		// Area-weighted height ≈ terminal-dominated (the knob), not the tower's 60.
		expect(merged[0].height).toBeLessThan(20);
		expect(merged[0].height).toBeGreaterThan(11);
	});

	it('keeps neighbouring (non-overlapping) buildings separate', () => {
		const a = item(1, rect(0, 0, 10, 10), 15);
		const b = item(2, rect(10, 0, 20, 10), 15); // shares the wall, doesn't overlap
		const merged = mergeFootprints([a, b]);
		expect(merged).toHaveLength(2);
	});

	it('passes a lone footprint through unchanged', () => {
		const a = item(7, rect(0, 0, 8, 8), 9, 3);
		const merged = mergeFootprints([a]);
		expect(merged).toHaveLength(1);
		expect(merged[0].ids).toEqual([7]);
		expect(merged[0].height).toBe(9);
		expect(merged[0].baseY).toBe(3);
	});

	it('takes the lowest base across merged members', () => {
		const a = item(1, rect(0, 0, 20, 20), 10, 5);
		const b = item(2, rect(8, 8, 12, 12), 40, 2); // overlaps, lower base
		expect(mergeFootprints([a, b])[0].baseY).toBe(2);
	});
});
