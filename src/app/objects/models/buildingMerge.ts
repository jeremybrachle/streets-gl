import {AABB2D, Point2D, Polygon2D, convexHull2D} from "~/app/collision/FootprintCollision";

// Strata Lane B (s13) — BUILDINGS, increment B3.1: merge the footprints that make up ONE real
// building before matching. OSM maps large/landmark buildings (the Ferry Building, malls, …) as a
// building OUTLINE plus several `building:part` polygons that sit INSIDE/ON it. Matching each part
// independently drops a different kit model on each piece → clashing styles ("multiple skins"). We
// cluster footprints that OVERLAP (parts contained in / crossing the outline) and fit ONE model to the
// union. Adjacency is NOT enough — neighbouring rowhouses share a wall but shouldn't merge — so we use
// true convex overlap (SAT), AABB-broadphased to stay cheap on dense tiles. Pure, TDD'd.

export interface FootprintItem {
	id: number;
	polygon: Polygon2D; // convex hull, tile-local XZ
	aabb: AABB2D;
	height: number;
	baseY: number;
}

export interface MergedFootprint {
	ids: number[];      // all member building ids (every one gets its extrusion hidden)
	polygon: Polygon2D; // convex hull of the union
	height: number;     // area-weighted mean of the members (knob: dominant vs tallest)
	baseY: number;      // lowest base of the members
}

function aabbOverlap(a: AABB2D, b: AABB2D): boolean {
	return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

/** Polygon area via the shoelace formula (absolute; winding-independent). */
export function polygonArea(poly: Polygon2D): number {
	let s = 0;
	for (let i = 0; i < poly.length; i++) {
		const a = poly[i], b = poly[(i + 1) % poly.length];
		s += a.x * b.z - b.x * a.z;
	}
	return Math.abs(s) / 2;
}

// True if two CONVEX polygons overlap, via the separating-axis theorem: if any edge normal of either
// polygon separates their projections, they don't overlap. Touching-only counts as not overlapping.
export function convexOverlap(a: Polygon2D, b: Polygon2D): boolean {
	if (a.length < 3 || b.length < 3) return false;
	const polys = [a, b];
	for (const poly of polys) {
		for (let i = 0; i < poly.length; i++) {
			const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
			// Edge normal (axis to project onto).
			const axX = -(p2.z - p1.z), axZ = p2.x - p1.x;

			let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
			for (const p of a) {
				const d = p.x * axX + p.z * axZ;
				if (d < aMin) aMin = d; if (d > aMax) aMax = d;
			}
			for (const p of b) {
				const d = p.x * axX + p.z * axZ;
				if (d < bMin) bMin = d; if (d > bMax) bMax = d;
			}
			if (aMax <= bMin || bMax <= aMin) {
				return false; // separating axis found
			}
		}
	}
	return true;
}

/**
 * Cluster footprints by overlap (union-find, AABB-broadphased + SAT), then fit one merged footprint per
 * cluster: convex hull of all member vertices, area-weighted mean height, lowest base. Pure. A lone
 * footprint passes through as its own group (its hull unchanged).
 */
export function mergeFootprints(items: readonly FootprintItem[]): MergedFootprint[] {
	const n = items.length;
	const parent = new Array(n).fill(0).map((_, i) => i);
	const find = (i: number): number => {
		while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
		return i;
	};
	const union = (i: number, j: number): void => { parent[find(i)] = find(j); };

	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			if (find(i) === find(j)) continue;
			if (aabbOverlap(items[i].aabb, items[j].aabb) && convexOverlap(items[i].polygon, items[j].polygon)) {
				union(i, j);
			}
		}
	}

	const groups = new Map<number, number[]>();
	for (let i = 0; i < n; i++) {
		const r = find(i);
		const g = groups.get(r);
		if (g) g.push(i); else groups.set(r, [i]);
	}

	const out: MergedFootprint[] = [];
	for (const members of groups.values()) {
		const ids: number[] = [];
		const pts: Point2D[] = [];
		let weighted = 0, areaSum = 0, baseY = Infinity;
		for (const m of members) {
			const it = items[m];
			ids.push(it.id);
			for (const p of it.polygon) pts.push(p);
			const area = Math.max(polygonArea(it.polygon), 1e-6);
			weighted += it.height * area;
			areaSum += area;
			if (it.baseY < baseY) baseY = it.baseY;
		}
		const polygon = members.length === 1 ? items[members[0]].polygon : convexHull2D(pts);
		if (polygon.length < 3) continue;
		out.push({ids, polygon, height: weighted / areaSum, baseY});
	}
	return out;
}
