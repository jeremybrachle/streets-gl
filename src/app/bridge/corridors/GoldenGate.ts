import {BridgeCorridor, arcLengthAtNode} from "../BridgeDeck";

// Golden Gate Bridge roadway centerline — OSM way 537838948 (the east carriageway), each node
// projected to world mercator meters with MathUtils.degrees2meters, i.e. the exact frame the car
// drives in. The long middle segment (node 15 -> node 16) is the main span OVER THE WATER; the
// clustered nodes at each end are the approach viaducts over land.
const CENTERLINE: [number, number][] = [
	[4555736.7, -13634483.8], [4555731.0, -13634479.3], [4555715.7, -13634468.4],
	[4555700.7, -13634458.8], [4555684.0, -13634448.9], [4555665.2, -13634438.9],
	[4555648.4, -13634431.1], [4555630.2, -13634423.8], [4555612.6, -13634417.7],
	[4555594.3, -13634412.1], [4555576.4, -13634407.3], [4555557.1, -13634403.4],
	[4555539.1, -13634400.4], [4555520.1, -13634398.2], [4555497.7, -13634395.9],
	[4555476.8, -13634393.9], [4552567.9, -13634125.0], [4552553.0, -13634123.2],
	[4552537.7, -13634120.8], [4552522.3, -13634117.7], [4552508.0, -13634114.1],
	[4552493.4, -13634109.9], [4552477.3, -13634104.2], [4552459.7, -13634097.2],
	[4552443.5, -13634090.1], [4552427.4, -13634081.9], [4552412.3, -13634073.3],
	[4552397.2, -13634063.9], [4552380.8, -13634052.6], [4552364.7, -13634042.0],
	[4552346.7, -13634029.9],
];

// The elevated span = the long over-water segment between the two approach clusters: node 15 (south
// shore) to node 16 (north shore). Outside it the deck ramps down onto the land approaches.
const SPAN_A = CENTERLINE[15];
const SPAN_B = CENTERLINE[16];
const SPAN_MID: [number, number] = [(SPAN_A[0] + SPAN_B[0]) / 2, (SPAN_A[1] + SPAN_B[1]) / 2];

export const GOLDEN_GATE_CORRIDOR: BridgeCorridor = {
	id: 'golden-gate',
	centerline: CENTERLINE,
	// Defaults below = the values the user tuned live as the best fit that clears the terrain without
	// digging in. Still adjustable in the panel; Reset restores these.
	halfWidth: 17,    // mercator m lateral reach from the centerline (user-tuned 2026-06-25)
	deckHeight: 106,  // height of the flat span over the water (user-tuned 2026-06-25)
	rampLength: 600,  // approach ramp reach onto the land (clamped per-side to the approach length)
	maxGrade: 0.02,   // 2% — gentle ramps (auto-extends toward this, capped by the approach length)
	spanStart: arcLengthAtNode(CENTERLINE, 15),
	spanEnd: arcLengthAtNode(CENTERLINE, 16),

	// Visual hero model (CC-BY GGB GLB) — decoupled decoration over the drivable deck. Transform below =
	// the values the user dialled in live via the Bridge panel (2026-06-25) so the model sits on the
	// deck (the GLB is stylized, so it's NOT 1:1 — some legs sit under the water). Reset restores these.
	modelEnabled: true,
	modelAnchor: SPAN_MID,
	modelScale: 1.5,
	modelStretch: 2.5,
	modelYaw: -3.05,
	modelOffsetX: -55,
	modelOffsetY: 133,
	modelOffsetZ: 6,
};
