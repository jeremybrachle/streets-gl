// Bridge deck — the first piece in the discrete road-piece catalog (see
// worlddrive/research/chatgpt-brainstorm-discrete.md). A BridgeCorridor is pure DATA the
// runtime override store holds; deckHeightAt() is a pure, smooth-by-construction height
// function the car's ground query and the deck-mesh builder both read. Nothing here touches
// the engine — it's unit-tested in BridgeDeck.test.ts.
//
// Contract (the "piece" guarantee): on the main span the deck is flat at deckHeight; near each
// end it ramps to the ground via a smoothstep that is C¹ (no bumps) and grade-limited (slope
// never exceeds maxGrade — the ramp auto-extends if it has to). Off the corridor it returns
// null, and the caller falls back to the DEM (open-world behaviour, untouched).

export interface BridgeCorridor {
	/** Stable id for persisting tuned overrides (localStorage / export). Omit for transient corridors. */
	id?: string;
	/** Centerline polyline in world mercator meters: [x, z] pairs (the car's frame). */
	centerline: [number, number][];
	/** Half the deck width in world mercator meters — lateral reach from the centerline. */
	halfWidth: number;
	/** Target deck height (world height units) on the main span. */
	deckHeight: number;
	/** Desired on/off ramp blend length (meters along the centerline) at each end. */
	rampLength: number;
	/** Max allowed |slope| (rise/run) on the ramps. The ramp auto-extends to honor this. */
	maxGrade: number;
	/**
	 * Optional ELEVATED span in arc-length meters: the deck is flat at deckHeight only over
	 * [spanStart, spanEnd] (the bridge / water crossing) and ramps OUTWARD onto the land at each end,
	 * going null beyond the ramp so the land approaches stay normal ground road. Omit both to get the
	 * legacy whole-corridor deck (flat middle, ramps at the very ends). Derived from the OSM bridge
	 * span; for now declared per corridor (e.g. the GGB main span between its two approach clusters).
	 */
	spanStart?: number;
	spanEnd?: number;

	// --- Optional VISUAL hero model (e.g. the Golden Gate GLB) ---
	// The model is a decoupled DECORATION: this deck math remains the drivable surface, the model just
	// sits over it. Because the supplied GGB GLB is stylized (not proportioned to the real span), these
	// are live-tunable in the Bridge panel — you eyeball the model onto the deck. All optional; absent =
	// no model. Built mesh is normalized so its longest horizontal axis = local +X (the span axis).
	/** Draw the hero model for this corridor. */
	modelEnabled?: boolean;
	/** World (x, z) the model CENTER is placed at — typically the elevated span's midpoint. */
	modelAnchor?: [number, number];
	/** Uniform scale applied to the (origin-centered) model. */
	modelScale?: number;
	/** Extra multiplier on the span axis (local +X) ONLY — lengthen the bridge without fattening it. */
	modelStretch?: number;
	/** Rotation (radians) about the vertical axis to align the model's +X span axis to the world span. */
	modelYaw?: number;
	/** Fine world-space nudge after placement (modelOffsetY raises the deck to sit at deckHeight). */
	modelOffsetX?: number;
	modelOffsetY?: number;
	modelOffsetZ?: number;
}

/** Cumulative arc-length (meters) from the centerline start to node `index`. */
export function arcLengthAtNode(centerline: [number, number][], index: number): number {
	let acc = 0;
	const last = Math.min(index, centerline.length - 1);
	for (let i = 0; i < last; i++) {
		const [ax, az] = centerline[i];
		const [bx, bz] = centerline[i + 1];
		acc += Math.hypot(bx - ax, bz - az);
	}
	return acc;
}

// smoothstep: C¹ (zero slope at both ends), max derivative 1.5 at t=0.5.
const SMOOTHSTEP_MAX_SLOPE = 1.5;

// Each ramp is capped to this fraction of the corridor so a real flat MAIN SPAN always survives in
// the middle — i.e. the deck genuinely reaches deckHeight and raising it visibly lifts the road. If
// honoring maxGrade would need a longer ramp than the cap allows, the ramp stays at the cap and
// simply gets steeper: a deliberate, visible trade rather than the ramps swallowing the whole span.
const RAMP_MAX_FRACTION = 0.4;

function smoothstep(t: number): number {
	return t * t * (3 - 2 * t);
}

export interface PolylineProjection {
	/** Arc-length distance from the polyline start to the closest point. */
	s: number;
	/** Perpendicular distance from the query point to the closest point. */
	lateral: number;
	/** Total polyline length. */
	totalLength: number;
}

/** Closest point on a polyline to (px, pz): arc-length position + lateral offset. */
export function projectPointToPolyline(
	centerline: [number, number][],
	px: number,
	pz: number
): PolylineProjection {
	let bestDist2 = Infinity;
	let bestS = 0;
	let bestLateral = 0;
	let acc = 0;

	for (let i = 0; i < centerline.length - 1; i++) {
		const [ax, az] = centerline[i];
		const [bx, bz] = centerline[i + 1];
		const dx = bx - ax;
		const dz = bz - az;
		const segLen2 = dx * dx + dz * dz;
		const segLen = Math.sqrt(segLen2);

		let t = segLen2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / segLen2 : 0;
		t = Math.max(0, Math.min(1, t));

		const cx = ax + t * dx;
		const cz = az + t * dz;
		const ddx = px - cx;
		const ddz = pz - cz;
		const d2 = ddx * ddx + ddz * ddz;

		if (d2 < bestDist2) {
			bestDist2 = d2;
			bestS = acc + t * segLen;
			bestLateral = Math.sqrt(d2);
		}
		acc += segLen;
	}

	return {s: bestS, lateral: bestLateral, totalLength: acc};
}

/**
 * Height of the bridge deck at world (x, z), or null if the point is off the corridor.
 * groundY is the DEM height the car would otherwise read — the ramp blends down to it.
 */
export function deckHeightAt(
	corridor: BridgeCorridor,
	x: number,
	z: number,
	groundY: number
): number | null {
	if (corridor.centerline.length < 2) {
		return null;
	}

	const {s, lateral, totalLength} = projectPointToPolyline(corridor.centerline, x, z);
	if (lateral > corridor.halfWidth) {
		return null;
	}

	return deckHeightFromS(corridor, s, totalLength, groundY);
}

/**
 * The deck-height LAW as a pure function of arc-length `s` along the corridor — no projection. This is
 * the shared primitive `deckHeightAt` is built on: the car's query reaches it by projecting an arbitrary
 * (x, z) onto the centerline (above); a renderer that already walks the centerline by CUMULATIVE
 * arc-length calls this directly with that `s`. Calling this directly avoids the per-vertex re-projection
 * that — where a path nears itself — assigns a non-monotonic `s` and folds the lifted ribbon.
 *
 * `totalLength` is the corridor's full arc length (so the ramps land at its two ends); `groundY` is the
 * DEM the ramps blend down to. Returns null only inside a declared span beyond the ramp foot (the land
 * approach stays normal ground road); the whole-corridor profile is non-null at every `s` in [0, total].
 */
export function deckHeightFromS(
	corridor: BridgeCorridor,
	s: number,
	totalLength: number,
	groundY: number
): number | null {
	const dh = corridor.deckHeight - groundY;
	const gradeRamp = corridor.maxGrade > 0 ? (SMOOTHSTEP_MAX_SLOPE * Math.abs(dh)) / corridor.maxGrade : 0;

	// Declared bridge span: flat over [a, b] (the water crossing), ramp OUTWARD onto the land at each
	// end (down to the DEM), null beyond the ramp so the approaches stay normal ground road.
	if (corridor.spanStart !== undefined && corridor.spanEnd !== undefined) {
		const a = corridor.spanStart;
		const b = corridor.spanEnd;

		if (s >= a && s <= b) {
			return corridor.deckHeight;
		}

		// Distance from the nearer shore onto the land, and how much approach room is available
		// before the corridor end (the ramp never runs off the end).
		const onSouth = s < a;
		const dLand = onSouth ? a - s : s - b;
		const approach = onSouth ? a : totalLength - b;
		const eff = Math.min(Math.max(corridor.rampLength, gradeRamp), approach);

		if (eff <= 0 || dLand >= eff) {
			return null; // beyond the ramp foot: ground road, not bridge
		}

		const t = 1 - dLand / eff; // t = 1 at the shore (deck), t -> 0 at the ramp foot (ground)
		return groundY + smoothstep(t) * dh;
	}

	// Grade-limited ramp: a smoothstep over `eff` meters has max slope 1.5*|dh|/eff, so to keep
	// it under maxGrade the ramp must be at least 1.5*|dh|/maxGrade long. Honor the requested
	// rampLength when it's already gentle enough, otherwise auto-extend — but cap each ramp at
	// RAMP_MAX_FRACTION of the corridor so a flat main span always remains (see the const above).
	let eff = Math.max(corridor.rampLength, gradeRamp);
	eff = Math.min(eff, totalLength * RAMP_MAX_FRACTION);

	const dEnd = Math.min(s, totalLength - s);
	if (dEnd >= eff) {
		return corridor.deckHeight;
	}

	const t = eff > 0 ? dEnd / eff : 1;
	return groundY + smoothstep(t) * dh;
}
