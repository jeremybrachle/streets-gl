import {BridgeCorridor, arcLengthAtNode} from "../BridgeDeck";
import MathUtils from "~/lib/math/MathUtils";

// San Francisco–Oakland Bay Bridge — WEST SPAN (the SF ↔ Yerba Buena Island double suspension
// bridge), as a drivable elevated corridor. Centerline stitched from the OSM I-80 mainline
// (layer-2 carriageway): the SF approach descending toward grade in the city (ways 202485364 /
// 1343738800), the West span itself (way 8921938, SF anchorage → YBI), and the YBI landing
// (23874736 / 1212176124). Coords are projected with MathUtils.degrees2meters — the exact frame the
// car drives in (same as GoldenGate.ts).
//
// Why approaches matter: the deck is flat+elevated only over the SPAN and ramps DOWN to the DEM at
// each end. Without approach length the ramp has nowhere to descend (it looks like a wall) — the
// s14-first-pass bug the user caught. These approach nodes give the ramp ~400–500 m of run.
//
// All scalar values are first-guess seeds — dial them in live via the dev panel's corridor selector.

// Stitched through-route, ordered SF-inland → Yerba Buena Island (lat, lon from OSM).
const APPROACH_SF: [number, number][] = [
	[37.78296, -122.39564], // descending toward the SF street grade
	[37.78317, -122.39536],
	[37.78546, -122.39185],
];
const SPAN_SF: [number, number] = [37.78620, -122.39073]; // SF anchorage (span start)
const SPAN_YBI: [number, number] = [37.80808, -122.36729]; // Yerba Buena Island (span end)
const APPROACH_YBI: [number, number][] = [
	[37.80898, -122.36632],
	[37.81046, -122.36469],
	[37.81131, -122.36378], // back onto YBI land
];

// Densify the (near-straight) span into evenly spaced nodes so the ribbon — and future side support
// beams — have geometry to follow.
const SPAN_SUBDIV = 10;
const spanLatLon: [number, number][] = [];
for (let i = 0; i <= SPAN_SUBDIV; i++) {
	const t = i / SPAN_SUBDIV;
	spanLatLon.push([
		SPAN_SF[0] + (SPAN_YBI[0] - SPAN_SF[0]) * t,
		SPAN_SF[1] + (SPAN_YBI[1] - SPAN_SF[1]) * t,
	]);
}

const latLon: [number, number][] = [...APPROACH_SF, ...spanLatLon, ...APPROACH_YBI];

const CENTERLINE: [number, number][] = latLon.map(([lat, lon]) => {
	const v = MathUtils.degrees2meters(lat, lon);
	return [v.x, v.y];
});

// The elevated flat span = the densified span nodes (the approaches ramp down outside it).
const SPAN_START_INDEX = APPROACH_SF.length;
const SPAN_END_INDEX = APPROACH_SF.length + spanLatLon.length - 1;
export const BAY_BRIDGE_CORRIDOR: BridgeCorridor = {
	id: 'bay-bridge-west',
	centerline: CENTERLINE,
	// First-guess seeds — tune live in the panel (Reset restores these).
	halfWidth: 20,    // Bay Bridge decks are wider than the GGB (5 lanes/deck)
	deckHeight: 40,   // West-span elevation over the water; user tunes to sit at the highway level
	rampLength: 500,  // ~the approach length we have; ramp auto-extends within it
	maxGrade: 0.06,   // 6% — steeper than GGB so the ramp visibly reaches grade within the short approach
	spanStart: arcLengthAtNode(CENTERLINE, SPAN_START_INDEX),
	spanEnd: arcLengthAtNode(CENTERLINE, SPAN_END_INDEX),

	// NO hero model. The red GGB suspension GLB is wrong for the Bay Bridge and must never appear here.
	// Both modelEnabled:false AND the absence of modelAnchor guarantee renderBridgeModel skips this
	// corridor (it requires `modelEnabled && modelAnchor`). The Bay Bridge look will come from
	// procedural side support beams on the deck (next sub-step), or a fitted bridge model later.
	modelEnabled: false,
};
