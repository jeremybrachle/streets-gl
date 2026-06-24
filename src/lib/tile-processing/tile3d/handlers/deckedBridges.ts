import OSMReference, {OSMReferenceType} from "~/lib/tile-processing/vector/features/OSMReference";

// OSM way ids of bridges we draw our own elevated deck mesh for (see src/app/bridge). The flat,
// terrain-draped roadway the engine would otherwise project is suppressed for these ways so it
// doesn't sit as a phantom "lower deck" under the elevated deck. Only ways with a real replacement
// deck belong here — suppressing a deckless bridge would leave an undrivable hole.
//
// We match by OSM way id rather than the bridge=* tag because the live data comes from streets.gl's
// pre-processed PBF vector tiles, which DON'T carry a bridge tag — but they DO preserve the original
// osmId (verified: GGB east 537838948 + west 595194543 arrive as osmType=Way). The descriptor's
// isBridge flag (set only on the raw-OSM/Overpass path) is therefore not relied on here.
//
// Keep in sync with the BridgeRegistry corridors (e.g. GOLDEN_GATE_CORRIDOR -> Golden Gate, OSM
// ways 537838948/595194543).
// Includes every OSM way that makes up the bridge's flat draped footprint — carriageways, the
// bridge=yes sidewalks, AND the man_made=bridge area polygon — so nothing renders under the deck.
export const DECKED_BRIDGE_WAY_IDS: ReadonlySet<number> = new Set<number>([
	537838948, // Golden Gate Bridge — east carriageway (our deck centerline)
	595194543, // Golden Gate Bridge — west carriageway (parallel, covered by the same wide deck)
	370672707, // Golden Gate Bridge — man_made=bridge footprint area (renders as a flat grey pavement)
	// The GGB sidewalks are split into many bridge=yes footway/cycleway segments (Overpass:
	// way[bridge=yes][highway~footway|cycleway|path|steps] over the GGB bbox). A driving sim doesn't
	// need sidewalks on bridges, so suppress them all so none render as thin strips over the water.
	368033990, // East Sidewalk (cycleway)
	368049578, // West Sidewalk (cycleway)
	970229713, // East Sidewalk (footway segment)
	1267474226, // East Sidewalk (footway segment)
	28102878, // bridge footway segment
	422270478, // bridge footway segment
	810370144, // bridge footway segment
	925384110, // bridge footway segment

	// --- GGB TOWERS (the grey columns jutting up through the hero model) ---
	// The two main towers are mapped in OSM as dense clusters of man_made=tower + building ways at the
	// tower bases (south ≈ 37.814, north ≈ 37.8255 — symmetric about the span midpoint 37.8199). The PBF
	// tiles extrude them as grey buildings; suppress them so only the hero GLB's towers show. Enumerated
	// via Overpass (way[building],way[man_made=tower] over the GGB span bbox), filtered to the two
	// tower clusters. The hero model supplies its own towers, so nothing is lost.
	// South tower:
	1329545860, 1329549315, 1329549317, 1329550017, 1329550151, 1329558939,
	1329761876, 1329761877, 1329761878, 1329761879, 1329761880, 1329761881,
	1330049620, 1330350431, 1330586852, 1330829528, 1330830769, 1330830988, 1330831175,
	// North tower:
	1330832664, 1330832665, 1330832666, 1330832667, 1330832669, 1330832670, 1330832671,
	1330832673, 1330832674, 1330832677, 1330832678, 1330832679, 1330832680, 1330832682,
	1330832684, 1330832685, 1330832687, 1330832688, 1330832689,

	// --- SOUTH TOWER FENDER ("the island underneath") ---
	// The concrete fender ring around the south tower base sits MID-STRAIT (37.814, over open water), so
	// it renders as a small land island under the bridge. It's a fake structure (not the real shore),
	// so suppressing it reveals the water tile beneath. (The NORTH tower's fender is left alone — it sits
	// against the real Marin coastline, which must keep rendering.)
	1329971884, // south tower fender — natural=coastline ring
	1330739248, // south tower fender — man_made=breakwater
	432712872,  // south tower fender — man_made=breakwater
]);

// True when this feature (a roadway/sidewalk polyline OR a bridge area polygon) belongs to a bridge
// way we replace with our own deck mesh, so the engine should skip its flat draped geometry. Matched
// purely by OSM way id — the live PBF tiles preserve osmId but carry no bridge=* tag.
export function isDeckedBridgeWay(
	osmReference: OSMReference | null,
	deckedWayIds: ReadonlySet<number> = DECKED_BRIDGE_WAY_IDS
): boolean {
	if (!osmReference || osmReference.type !== OSMReferenceType.Way) {
		return false;
	}

	return deckedWayIds.has(osmReference.id);
}
