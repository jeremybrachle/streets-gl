// Strata Lane B (s13) — BUILDINGS, increment B3: pick which of the kit's buildings to drop on a given
// OSM footprint. The model is STRETCHED to the real footprint (so the silhouette is always right), but
// picking a source whose proportions already match avoids ugly cross-squash (a square tower smeared
// across a long thin lot). Deterministic per footprint position → the city looks identical each time a
// tile streams in. Pure — no engine deps, TDD'd.

export interface SourceFootprint {
	width: number;
	depth: number;
}

/** Aspect ratio of a rectangle, always ≥ 1 (orientation-independent). */
export function aspectOf(width: number, depth: number): number {
	const a = Math.max(Math.abs(width), 1e-6);
	const b = Math.max(Math.abs(depth), 1e-6);
	return Math.max(a, b) / Math.min(a, b);
}

// Deterministic [0,1) hash of a float seed (position-derived → stable across rebuilds).
function hash01(n: number): number {
	const s = Math.sin(n) * 43758.5453;
	return s - Math.floor(s);
}

/**
 * Choose a source building index for a footprint of the given long/short side lengths. Scores each
 * source by how close its aspect ratio is to the footprint's (log-distance, so 2:1 and 1:2 are equal),
 * then picks — for variety — among all sources within `band` of the best by a position-seeded hash.
 * `seed` should be derived from the footprint's world position so the choice is stable. Returns 0 when
 * there are no sources (caller guards).
 */
export function pickBuildingIndex(
	footprintLong: number,
	footprintShort: number,
	sources: readonly SourceFootprint[],
	seed: number,
	band = 0.35
): number {
	if (sources.length === 0) {
		return 0;
	}

	const targetAspect = aspectOf(footprintLong, footprintShort);
	const scores = sources.map(s => Math.abs(Math.log(aspectOf(s.width, s.depth)) - Math.log(targetAspect)));

	let best = Infinity;
	for (const sc of scores) {
		if (sc < best) best = sc;
	}

	// All sources whose aspect is within `band` of the best — the acceptable pool for this footprint.
	const pool: number[] = [];
	for (let i = 0; i < scores.length; i++) {
		if (scores[i] <= best + band) pool.push(i);
	}

	const pick = Math.floor(hash01(seed) * pool.length) % pool.length;
	return pool[pick];
}
