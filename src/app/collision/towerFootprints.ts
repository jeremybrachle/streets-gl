import {Polygon2D, convexHull2D} from "./FootprintCollision";

export {Polygon2D};

// Strata physics spike — auto-derive collision footprints for a bridge model's TOWERS from its merged
// vertex buffer (model-local, interleaved x,y,z). The towers are dense, full-height vertex clusters at
// two X positions (the probe showed ~10.6k verts/bin at the towers vs ~480 elsewhere). Each tower's
// geometry spans the full Z width, with the roadway running down the middle and the two legs at the Z
// extremes — so we split each tower into a +Z leg and a −Z leg (separate convex hulls), leaving the
// road gap between them drivable. The deck and the swept cables (all within the central Z band) are
// excluded by the Z threshold, so only the leg columns become collision. This generalizes to any
// placed model with tall vertical supports straddling a roadway.

export interface TowerLegOptions {
	bins?: number;          // X bins across the span used to find the dense tower clusters
	densityFactor?: number; // a bin is "tower" if its vert count exceeds this × the median bin count
	zSplitFrac?: number;    // legs are verts with |z| > zSplitFrac × max|z| (excludes the central road/cables)
}

/**
 * Find a model's tower-leg footprints (model-local XZ convex polygons). Returns [] when no dense
 * tower cluster stands out (e.g. a model with no towers) — collision then simply isn't added.
 */
export function extractTowerLegFootprints(position: ArrayLike<number>, opts: TowerLegOptions = {}): Polygon2D[] {
	const bins = opts.bins ?? 24;
	const densityFactor = opts.densityFactor ?? 3;
	const zSplitFrac = opts.zSplitFrac ?? 0.6;

	const n = position.length / 3;
	if (n < 12) {
		return [];
	}

	let minX = Infinity, maxX = -Infinity, maxAbsZ = 0;
	for (let i = 0; i < position.length; i += 3) {
		const x = position[i];
		const z = position[i + 2];
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		const az = Math.abs(z);
		if (az > maxAbsZ) maxAbsZ = az;
	}
	const spanW = (maxX - minX) || 1;

	// Vert count per X bin.
	const count = new Array(bins).fill(0);
	const binOf = (x: number): number =>
		Math.min(bins - 1, Math.max(0, Math.floor(((x - minX) / spanW) * bins)));
	for (let i = 0; i < position.length; i += 3) {
		count[binOf(position[i])]++;
	}

	// Median bin count (towers stand far above it).
	const sorted = count.slice().sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)] || 1;
	const threshold = densityFactor * median;

	// Merge adjacent dense bins into tower clusters; record each cluster's X window.
	const clusters: {lo: number; hi: number}[] = [];
	let runStart = -1;
	for (let b = 0; b <= bins; b++) {
		const dense = b < bins && count[b] > threshold;
		if (dense && runStart < 0) {
			runStart = b;
		} else if (!dense && runStart >= 0) {
			clusters.push({
				lo: minX + (runStart / bins) * spanW,
				hi: minX + (b / bins) * spanW,
			});
			runStart = -1;
		}
	}

	const zThresh = zSplitFrac * maxAbsZ;
	const polys: Polygon2D[] = [];

	for (const c of clusters) {
		const posLeg: {x: number; z: number}[] = [];
		const negLeg: {x: number; z: number}[] = [];
		for (let i = 0; i < position.length; i += 3) {
			const x = position[i];
			if (x < c.lo || x > c.hi) {
				continue;
			}
			const z = position[i + 2];
			if (z > zThresh) {
				posLeg.push({x, z});
			} else if (z < -zThresh) {
				negLeg.push({x, z});
			}
		}
		const hp = convexHull2D(posLeg);
		const hn = convexHull2D(negLeg);
		if (hp.length >= 3) polys.push(hp);
		if (hn.length >= 3) polys.push(hn);
	}

	return polys;
}
