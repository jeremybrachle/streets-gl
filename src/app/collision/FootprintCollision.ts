// Strata physics spike — building wall collision, pure math (TDD'd; no engine deps).
//
// Buildings are extruded prisms; the car drives at ground level, so collision is a 2D problem in
// the XZ plane: keep the car's center circle out of each building's footprint rectangle. We use an
// axis-aligned box per building (cheap first pass; convex polygons can come later) and resolve by
// SLIDING — push the circle out along the shortest direction, leaving tangential motion intact, so
// the car scrapes along a wall instead of sticking.

/** Axis-aligned footprint rectangle in the XZ plane (world or tile-local meters). */
export interface AABB2D {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
}

/** A point in the XZ ground plane. */
export interface Point2D {
	x: number;
	z: number;
}

/** A convex footprint outline (CCW winding), the tight building boundary used for collision. */
export type Polygon2D = Point2D[];

/**
 * Build a footprint AABB from a slice of an extruded position buffer (interleaved x,y,z, tile-local
 * meters, y up). `vertexOffset`/`vertexCount` are in VERTICES (multiply by 3 for the float index) —
 * exactly what Tile.buildingOffsetMap stores.
 *
 * Returns null for features with no wall to hit: an empty slice, or anything shorter than
 * `minWallHeight` (flat footprint-only polygons — roofs/pavement decals come through the same
 * buffer at height ~0 and must NOT block the car).
 */
export function footprintFromBuffer(
	position: ArrayLike<number>,
	vertexOffset: number,
	vertexCount: number,
	minWallHeight: number
): AABB2D | null {
	if (vertexCount <= 0) {
		return null;
	}

	let minX = Infinity, maxX = -Infinity;
	let minZ = Infinity, maxZ = -Infinity;
	let minY = Infinity, maxY = -Infinity;

	const end = vertexOffset + vertexCount;
	for (let v = vertexOffset; v < end; v++) {
		const x = position[v * 3];
		const y = position[v * 3 + 1];
		const z = position[v * 3 + 2];
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
		if (z < minZ) minZ = z;
		if (z > maxZ) maxZ = z;
	}

	if (maxY - minY < minWallHeight) {
		return null;
	}

	return {minX, maxX, minZ, maxZ};
}

/**
 * Convex hull (CCW) of XZ points via Andrew's monotone chain. The world-axis AABB balloons for
 * buildings rotated off the mercator axes (SF's grid), bulging collision into the streets; the hull
 * follows the actual outline so the boundary matches the visible structure. Returns [] for <3 unique
 * points (degenerate footprint — no wall).
 */
export function convexHull2D(points: readonly Point2D[]): Polygon2D {
	const pts = points.slice().sort((a, b) => (a.x === b.x ? a.z - b.z : a.x - b.x));
	// Dedup.
	const uniq: Point2D[] = [];
	for (const p of pts) {
		const last = uniq[uniq.length - 1];
		if (!last || last.x !== p.x || last.z !== p.z) {
			uniq.push(p);
		}
	}
	if (uniq.length < 3) {
		return [];
	}

	const cross = (o: Point2D, a: Point2D, b: Point2D): number =>
		(a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

	const lower: Point2D[] = [];
	for (const p of uniq) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
			lower.pop();
		}
		lower.push(p);
	}

	const upper: Point2D[] = [];
	for (let i = uniq.length - 1; i >= 0; i--) {
		const p = uniq[i];
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
			upper.pop();
		}
		upper.push(p);
	}

	// Drop the duplicated endpoints; concatenation is CCW.
	lower.pop();
	upper.pop();
	return lower.concat(upper);
}

/** Build the AABB enclosing a polygon (broad-phase rectangle for a convex footprint). */
export function polygonAABB(poly: Polygon2D): AABB2D {
	let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
	for (const p of poly) {
		if (p.x < minX) minX = p.x;
		if (p.x > maxX) maxX = p.x;
		if (p.z < minZ) minZ = p.z;
		if (p.z > maxZ) maxZ = p.z;
	}
	return {minX, maxX, minZ, maxZ};
}

/**
 * Convex-hull footprint from an extruded position-buffer slice (same args as footprintFromBuffer):
 * the tight outline + its broad-phase AABB, or null for a flat (<minWallHeight) / degenerate feature.
 */
export function footprintHullFromBuffer(
	position: ArrayLike<number>,
	vertexOffset: number,
	vertexCount: number,
	minWallHeight: number
): {polygon: Polygon2D; aabb: AABB2D; height: number; baseY: number} | null {
	if (vertexCount <= 0) {
		return null;
	}

	let minY = Infinity, maxY = -Infinity;
	const pts: Point2D[] = [];
	const end = vertexOffset + vertexCount;
	for (let v = vertexOffset; v < end; v++) {
		const y = position[v * 3 + 1];
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
		pts.push({x: position[v * 3], z: position[v * 3 + 2]});
	}

	const height = maxY - minY;
	if (height < minWallHeight) {
		return null;
	}

	const polygon = convexHull2D(pts);
	if (polygon.length < 3) {
		return null;
	}

	return {polygon, aabb: polygonAABB(polygon), height, baseY: minY};
}

/** Translate a tile-local footprint into world space by the tile origin (X, Z meters). */
export function translateAABB(box: AABB2D, dx: number, dz: number): AABB2D {
	return {minX: box.minX + dx, maxX: box.maxX + dx, minZ: box.minZ + dz, maxZ: box.maxZ + dz};
}

/** Translate a tile-local polygon into world space. */
export function translatePolygon(poly: Polygon2D, dx: number, dz: number): Polygon2D {
	return poly.map(p => ({x: p.x + dx, z: p.z + dz}));
}

/** True if (x,z) is inside (or on) a CCW convex polygon. */
export function pointInConvex(x: number, z: number, poly: Polygon2D): boolean {
	const eps = 1e-9;
	for (let i = 0; i < poly.length; i++) {
		const a = poly[i];
		const b = poly[(i + 1) % poly.length];
		// CCW: interior is on the left of each directed edge → cross >= 0.
		const cross = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
		if (cross < -eps) {
			return false;
		}
	}
	return true;
}

/**
 * Closest point on a polygon's boundary to (x,z), plus the OUTWARD unit normal of the edge it lies
 * on (for ejecting a center that sits exactly on the boundary). Outward normal of a CCW edge a→b is
 * (dz, -dx) normalized.
 */
function closestOnPolygon(x: number, z: number, poly: Polygon2D): {cx: number; cz: number; nx: number; nz: number} {
	let bestD2 = Infinity;
	let cx = x, cz = z, nx = 0, nz = 0;

	for (let i = 0; i < poly.length; i++) {
		const a = poly[i];
		const b = poly[(i + 1) % poly.length];
		const ex = b.x - a.x;
		const ez = b.z - a.z;
		const len2 = ex * ex + ez * ez;
		let t = len2 > 0 ? ((x - a.x) * ex + (z - a.z) * ez) / len2 : 0;
		t = t < 0 ? 0 : (t > 1 ? 1 : t);
		const px = a.x + t * ex;
		const pz = a.z + t * ez;
		const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
		if (d2 < bestD2) {
			bestD2 = d2;
			cx = px;
			cz = pz;
			const nlen = Math.sqrt(len2) || 1;
			nx = ez / nlen;
			nz = -ex / nlen;
		}
	}

	return {cx, cz, nx, nz};
}

/**
 * Push the car circle out of a single convex footprint, sliding along the nearest edge. Inside → eject
 * through the closest edge (least penetration). Outside but within `radius` of the outline → push out
 * along the outward normal to exactly `radius` clearance. Clear → unchanged.
 */
export function resolveCircleVsConvex(x: number, z: number, radius: number, poly: Polygon2D): {x: number; z: number} {
	if (poly.length < 3) {
		return {x, z};
	}

	const {cx, cz, nx, nz} = closestOnPolygon(x, z, poly);
	const eps = 1e-9;

	if (pointInConvex(x, z, poly)) {
		// Eject to `radius` beyond the closest edge.
		return {x: cx + nx * radius, z: cz + nz * radius};
	}

	const dx = x - cx;
	const dz = z - cz;
	const d2 = dx * dx + dz * dz;
	if (d2 >= radius * radius) {
		return {x, z}; // outside and clear
	}

	if (d2 > eps) {
		const d = Math.sqrt(d2);
		return {x: cx + (dx / d) * radius, z: cz + (dz / d) * radius};
	}

	// On the boundary exactly — push along the edge's outward normal.
	return {x: cx + nx * radius, z: cz + nz * radius};
}

/** Slide the car circle out of every convex footprint over a couple of settling passes. */
export function resolveCircleVsPolygons(
	x: number,
	z: number,
	radius: number,
	polygons: readonly Polygon2D[],
	iterations = 2
): {x: number; z: number} {
	for (let pass = 0; pass < iterations; pass++) {
		let moved = false;
		for (const poly of polygons) {
			const before = {x, z};
			const out = resolveCircleVsConvex(x, z, radius, poly);
			x = out.x;
			z = out.z;
			if (x !== before.x || z !== before.z) {
				moved = true;
			}
		}
		if (!moved) {
			break;
		}
	}
	return {x, z};
}

/** True if the car circle at (x,z) with `radius` overlaps `box` (used for broad-phase + the picker). */
export function circleIntersectsAABB(x: number, z: number, radius: number, box: AABB2D): boolean {
	const cx = x < box.minX ? box.minX : (x > box.maxX ? box.maxX : x);
	const cz = z < box.minZ ? box.minZ : (z > box.maxZ ? box.maxZ : z);
	const dx = x - cx;
	const dz = z - cz;
	return dx * dx + dz * dz < radius * radius;
}

/**
 * Push the car circle (center x,z, `radius`) out of every overlapping footprint, sliding along the
 * shortest exit so tangential motion is preserved. Returns the corrected center. Resolving the boxes
 * over a couple of passes settles inside-corner cases (escaping one box can poke into a neighbour).
 * Velocity is NOT touched — the caller keeps integrating along heading, and we re-project each frame,
 * which IS the slide.
 */
export function resolveCircleVsAABBs(
	x: number,
	z: number,
	radius: number,
	boxes: readonly AABB2D[],
	iterations = 2
): {x: number; z: number} {
	const r2 = radius * radius;
	const eps = 1e-9;

	for (let pass = 0; pass < iterations; pass++) {
		let moved = false;

		for (const box of boxes) {
			// Closest point on the box to the circle center.
			const cx = x < box.minX ? box.minX : (x > box.maxX ? box.maxX : x);
			const cz = z < box.minZ ? box.minZ : (z > box.maxZ ? box.maxZ : z);
			const dx = x - cx;
			const dz = z - cz;
			const d2 = dx * dx + dz * dz;

			if (d2 >= r2) {
				continue; // not overlapping this box
			}

			if (d2 > eps) {
				// Center outside the box but within `radius` of a face/corner — push straight out.
				const d = Math.sqrt(d2);
				const push = radius - d;
				x += (dx / d) * push;
				z += (dz / d) * push;
			} else {
				// Center INSIDE the box — exit along the axis of least penetration (+ radius clear).
				const penL = x - box.minX; // toward -X
				const penR = box.maxX - x; // toward +X
				const penB = z - box.minZ; // toward -Z
				const penT = box.maxZ - z; // toward +Z
				const minPen = Math.min(penL, penR, penB, penT);
				if (minPen === penL) x = box.minX - radius;
				else if (minPen === penR) x = box.maxX + radius;
				else if (minPen === penB) z = box.minZ - radius;
				else z = box.maxZ + radius;
			}

			moved = true;
		}

		if (!moved) {
			break;
		}
	}

	return {x, z};
}
