// Strata Lane B (s13) — BUILDINGS, increment B1: pure placement math.
//
// Given a building's OSM footprint as an oriented minimum bounding box (OMBB — the tight rotated
// rectangle, computed engine-side by src/lib/math/OMBB.js) plus a target height, and the local
// dimensions of a source building GLB (baked + recentered so its base sits at y=0 and its footprint
// is centered on the local origin), produce the transform that stretches + orients that GLB to sit
// on the real footprint.
//
// The renderer composes the final matrix the same way renderBridgeModel does:
//     carMatrix = translate(anchor - origin) · yRotate(yaw) · scale(sx, sy, sz)
// applied to the origin-centered mesh. So this module's job is purely to compute {anchor, yaw,
// scale} — no engine deps, fully testable, and PORTABLE if the engine ever changes (the value the
// handoff calls out: the placement math survives a migration).
//
// Axis convention: world XZ ground plane, +Y up. A source building's local +X is its "width" axis
// and local +Z its "depth" axis. We align the source's LONGER horizontal axis to the footprint's
// LONGER side so the model is never squashed across its short dimension.

/** A point on the XZ ground plane (matches FootprintCollision.Point2D). */
export interface Point2D {
	x: number;
	z: number;
}

/** Local extents of a baked source building: width (X), depth (Z), height (Y). Base at y=0. */
export interface SourceDims {
	width: number;
	depth: number;
	height: number;
}

/** A footprint as an oriented rectangle: center, the two side lengths, and the long-side direction. */
export interface OMBBRect {
	centerX: number;
	centerZ: number;
	/** Length of the longer side. */
	longLen: number;
	/** Length of the shorter side. */
	shortLen: number;
	/** Unit direction of the longer side in XZ. */
	longDirX: number;
	longDirZ: number;
}

/** Transform parameters consumed by the renderer (composed as T·yRotate·S on an origin-centered mesh). */
export interface BuildingPlacement {
	/** World-space anchor (footprint center at ground height). */
	anchorX: number;
	anchorY: number;
	anchorZ: number;
	/** Rotation about +Y, radians. yaw = atan2(longDirZ, longDirX) for the chosen alignment. */
	yaw: number;
	scaleX: number;
	scaleY: number;
	scaleZ: number;
}

const EPS = 1e-6;

/**
 * Build an OMBBRect from the 4 corners of an oriented bounding box. Corners must be the rectangle's
 * vertices in order (adjacent corners are connected) — e.g. OMBB.js's [upperLeft, bottomLeft,
 * bottomRight, upperRight] adapted to {x,z}. Uses the two edges incident to corner[0]; tolerant of
 * either winding. Returns null for a degenerate (zero-area) box.
 */
export function ombbFromCorners(corners: readonly Point2D[]): OMBBRect | null {
	if (corners.length !== 4) {
		return null;
	}

	const c0 = corners[0];
	// Two edges sharing corner[0]: corner0→corner1 and corner0→corner3 (perpendicular for a rectangle).
	const eAx = corners[1].x - c0.x, eAz = corners[1].z - c0.z;
	const eBx = corners[3].x - c0.x, eBz = corners[3].z - c0.z;
	const lenA = Math.hypot(eAx, eAz);
	const lenB = Math.hypot(eBx, eBz);

	if (lenA < EPS || lenB < EPS) {
		return null;
	}

	const centerX = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
	const centerZ = (corners[0].z + corners[1].z + corners[2].z + corners[3].z) / 4;

	let longLen: number, shortLen: number, longDirX: number, longDirZ: number;
	if (lenA >= lenB) {
		longLen = lenA; shortLen = lenB;
		longDirX = eAx / lenA; longDirZ = eAz / lenA;
	} else {
		longLen = lenB; shortLen = lenA;
		longDirX = eBx / lenB; longDirZ = eBz / lenB;
	}

	return {centerX, centerZ, longLen, shortLen, longDirX, longDirZ};
}

/**
 * Compute the placement transform that fits a source building GLB onto a footprint rectangle.
 *
 * - Aligns the source's LONGER horizontal axis to the footprint's longer side (no cross-squash).
 * - Scales each axis independently to fill the footprint (X/Z) and reach `targetHeight` (Y).
 * - `groundY` is the terrain height at the footprint center (sampled by the caller; the building's
 *   base sits exactly there).
 *
 * yaw is returned so that, under the renderer's yRotate, the source's chosen long axis points along
 * the footprint's long direction. The yRotate SIGN is verified once in-browser (B2) and folded in
 * there if needed — this function stays convention-pure and testable.
 */
export function computeBuildingPlacement(
	rect: OMBBRect,
	targetHeight: number,
	src: SourceDims,
	groundY: number
): BuildingPlacement {
	const srcW = Math.max(src.width, EPS);
	const srcD = Math.max(src.depth, EPS);
	const srcH = Math.max(src.height, EPS);

	const baseYaw = Math.atan2(rect.longDirZ, rect.longDirX);

	let yaw: number, scaleX: number, scaleZ: number;
	if (src.width >= src.depth) {
		// Source long axis = local X → align X to the footprint's long side directly.
		yaw = baseYaw;
		scaleX = rect.longLen / srcW;
		scaleZ = rect.shortLen / srcD;
	} else {
		// Source long axis = local Z → rotate a quarter-turn so +Z points along the long side.
		yaw = baseYaw - Math.PI / 2;
		scaleZ = rect.longLen / srcD;
		scaleX = rect.shortLen / srcW;
	}

	return {
		anchorX: rect.centerX,
		anchorY: groundY,
		anchorZ: rect.centerZ,
		yaw,
		scaleX,
		scaleY: targetHeight / srcH,
		scaleZ
	};
}
