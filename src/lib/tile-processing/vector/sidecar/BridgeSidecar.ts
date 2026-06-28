import OSMReference, {OSMReferenceType} from "~/lib/tile-processing/vector/features/OSMReference";
import {SF_BRIDGE_SIDECAR} from "~/lib/tile-processing/vector/sidecar/sfBridgeSidecar.generated";

// One bridge/tunnel record recovered from OSM for a way the PBF vector tiles stripped these tags from.
// `layer` is the OSM `layer=*` ordinal (stacking order, NOT absolute height — see roadmap §1.1).
export interface BridgeSidecarEntry {
	bridge?: boolean;
	tunnel?: boolean;
	layer: number;
	lanes?: number;
}

export type BridgeSidecar = Record<number, BridgeSidecarEntry>;

// Region sidecars merged into one lookup. Growing this list past a couple cities is the signal to
// graduate to Protomaps tags (roadmap §5), not to keep adding sidecars.
const REGION_SIDECARS: BridgeSidecar[] = [
	SF_BRIDGE_SIDECAR
];

// Pure: find an osm WAY in a given set of sidecars. First match wins (regions don't overlap in practice).
export function lookupInSidecars(ref: OSMReference, sidecars: BridgeSidecar[]): BridgeSidecarEntry | null {
	if (!ref || ref.type !== OSMReferenceType.Way) {
		return null;
	}

	for (const sidecar of sidecars) {
		const entry = sidecar[ref.id];

		if (entry) {
			return entry;
		}
	}

	return null;
}

// Decode-time join entry point: returns the recovered bridge/tunnel tags for a PBF feature, or null.
export function lookupBridgeTags(ref: OSMReference): BridgeSidecarEntry | null {
	return lookupInSidecars(ref, REGION_SIDECARS);
}
