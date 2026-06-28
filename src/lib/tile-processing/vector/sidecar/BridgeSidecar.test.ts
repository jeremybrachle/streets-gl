import {lookupInSidecars, lookupBridgeTags, BridgeSidecar} from "~/lib/tile-processing/vector/sidecar/BridgeSidecar";
import {OSMReferenceType} from "~/lib/tile-processing/vector/features/OSMReference";

const way = (id: number) => ({type: OSMReferenceType.Way, id});

describe('lookupInSidecars (pure join)', () => {
	const a: BridgeSidecar = {100: {bridge: true, layer: 1, lanes: 3}};
	const b: BridgeSidecar = {200: {tunnel: true, layer: -1}};

	it('returns the entry for a way present in a sidecar', () => {
		expect(lookupInSidecars(way(100), [a, b])).toEqual({bridge: true, layer: 1, lanes: 3});
		expect(lookupInSidecars(way(200), [a, b])).toEqual({tunnel: true, layer: -1});
	});

	it('returns null for an unknown way', () => {
		expect(lookupInSidecars(way(999), [a, b])).toBeNull();
	});

	it('only joins WAY references (nodes/relations never carry way-keyed bridge tags)', () => {
		expect(lookupInSidecars({type: OSMReferenceType.Node, id: 100}, [a, b])).toBeNull();
		expect(lookupInSidecars({type: OSMReferenceType.Relation, id: 100}, [a, b])).toBeNull();
		expect(lookupInSidecars({type: OSMReferenceType.None, id: 100}, [a, b])).toBeNull();
	});

	it('is null-safe on a missing reference', () => {
		expect(lookupInSidecars(null, [a, b])).toBeNull();
	});

	it('first matching sidecar wins', () => {
		const c: BridgeSidecar = {100: {bridge: true, layer: 9}};
		expect(lookupInSidecars(way(100), [a, c]).layer).toBe(1);
	});
});

describe('lookupBridgeTags (real SF sidecar)', () => {
	it('recovers known SF bridge ways stripped from the PBF tiles', () => {
		// Golden Gate Bridge carriageway + Bay Bridge deck way (Checkpoint ① ground truth).
		expect(lookupBridgeTags(way(537838948))).toMatchObject({bridge: true, layer: 1});
		expect(lookupBridgeTags(way(236348360))).toMatchObject({bridge: true});
	});

	it('returns null for an arbitrary non-bridge way', () => {
		expect(lookupBridgeTags(way(1))).toBeNull();
	});
});
