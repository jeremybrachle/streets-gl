// Road-compiler: vertical classification (roadmap §1.1).
//
// Every road carries a *vertical class* derived UNIFORMLY from its tags — no per-bridge code:
//   +1 elevated   (bridge=yes / any non-"no" bridge tag)
//    0 ground     (default; pinned to the DEM)
//   -1 underground (tunnel / layer<0 / location=underground)
//
// The `layer` value is kept only as an ORDINAL for relative stacking (which deck sits above which in
// a multi-level interchange). It is NEVER multiplied into an absolute height: absolute height always
// comes from DEM ± clearance/depth, so the first very tall bridge does not break (the GGB is
// layer≈1 but ~67 m — `layer × constant` would be nonsense). Pure + unit-tested; no engine deps.

export type VerticalClass = -1 | 0 | 1;

/** The minimal tag shape the compiler needs. Mirrors what `OSMPolylineQualifierFactory` already
 *  sets on `descriptor` (`isBridge`, `bridgeLayer`) plus tunnel/layer for the −1 case. */
export interface RoadTags {
	/** bridge=yes (any non-"no" bridge value resolves to true upstream). */
	isBridge?: boolean;
	/** The `layer` ordinal carried alongside a bridge tag (descriptor.bridgeLayer). */
	bridgeLayer?: number;
	/** tunnel=yes / location=underground. */
	isTunnel?: boolean;
	/** Raw OSM `layer` (used for −1 detection and as the ordinal fallback). */
	layer?: number;
}

export interface Classification {
	verticalClass: VerticalClass;
	/** Relative stacking order only — never an absolute-height multiplier. */
	layerOrdinal: number;
}

export function classify(tags: RoadTags): Classification {
	const layerOrdinal = tags.bridgeLayer ?? tags.layer ?? 0;

	// Elevation preference wins first: a bridge is +1 regardless of an odd layer value.
	if (tags.isBridge) {
		return {verticalClass: 1, layerOrdinal};
	}

	// Underground: an explicit tunnel, or a negative layer with no bridge tag.
	if (tags.isTunnel || (tags.layer !== undefined && tags.layer < 0)) {
		return {verticalClass: -1, layerOrdinal};
	}

	return {verticalClass: 0, layerOrdinal};
}

export interface HeightParams {
	/** +1 target = DEM + clearance. Default ~5.5 m (typical overpass underclearance); refinable. */
	clearance?: number;
	/** −1 target = DEM − depth. Default ~5.5 m; refinable. */
	depth?: number;
}

export const DEFAULT_CLEARANCE = 5.5;
export const DEFAULT_DEPTH = 5.5;

/**
 * Absolute target height (the class *preference* the solver pulls toward) — always relative to the
 * DEM under the road, never `layer × constant`.
 */
export function targetHeight(verticalClass: VerticalClass, dem: number, params: HeightParams = {}): number {
	const clearance = params.clearance ?? DEFAULT_CLEARANCE;
	const depth = params.depth ?? DEFAULT_DEPTH;

	if (verticalClass === 1) {
		return dem + clearance;
	}
	if (verticalClass === -1) {
		return dem - depth;
	}
	return dem;
}
