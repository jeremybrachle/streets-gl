import {
	assembleRoadGraph,
	parseLayer,
	parseLanes,
	parseOneway,
	waysWithMissingNodes,
	latLonToFrameE,
	roadGraphToFrameEPolylines,
	DRIVABLE_HIGHWAYS,
	OverpassElement,
	RoadGraphAsset
} from "./RoadGraphAsset";
import MathUtils from "~/lib/math/MathUtils";

describe("parse helpers", () => {
	test("parseLayer handles ints, negatives, lists, blanks", () => {
		expect(parseLayer("1")).toBe(1);
		expect(parseLayer("-1")).toBe(-1);
		expect(parseLayer("1;2")).toBe(1);
		expect(parseLayer("")).toBeUndefined();
		expect(parseLayer(undefined)).toBeUndefined();
		expect(parseLayer(null)).toBeUndefined();
		expect(parseLayer("abc")).toBeUndefined();
	});

	test("parseLanes extracts the integer", () => {
		expect(parseLanes("2")).toBe(2);
		expect(parseLanes("6")).toBe(6);
		expect(parseLanes(undefined)).toBeUndefined();
		expect(parseLanes("none")).toBeUndefined();
	});

	test("parseOneway is true only for an actual oneway", () => {
		expect(parseOneway("yes")).toBe(true);
		expect(parseOneway("1")).toBe(true);
		expect(parseOneway("-1")).toBe(true); // reversed oneway is still oneway
		expect(parseOneway("no")).toBeUndefined();
		expect(parseOneway(undefined)).toBeUndefined();
	});
});

describe("assembleRoadGraph", () => {
	// A GGB-like motorway bridge (nodes 1-2-3), a residential road (3-4) sharing node 3 = a junction,
	// a footway bridge (excluded: not drivable), and a degenerate 1-node way (excluded). Node 99 is
	// returned by `>;` but unreferenced by any kept way (must NOT appear in the table).
	const elements: OverpassElement[] = [
		{type: "way", id: 537838948, nodes: [1, 2, 3], tags: {highway: "motorway", bridge: "yes", layer: "1", lanes: "6", oneway: "yes"}},
		{type: "way", id: 10, nodes: [3, 4], tags: {highway: "residential"}},
		{type: "way", id: 20, nodes: [5, 6], tags: {highway: "footway", bridge: "yes"}},
		{type: "way", id: 30, nodes: [7], tags: {highway: "service"}},
		{type: "node", id: 1, lat: 37.8094, lon: -122.4108},
		{type: "node", id: 2, lat: 37.8100, lon: -122.4110},
		{type: "node", id: 3, lat: 37.8110, lon: -122.4120},
		{type: "node", id: 4, lat: 37.8120, lon: -122.4130},
		{type: "node", id: 5, lat: 37.8000, lon: -122.4000},
		{type: "node", id: 6, lat: 37.8001, lon: -122.4001},
		{type: "node", id: 99, lat: 0, lon: 0}
	];

	const asset = assembleRoadGraph(elements, {
		region: "test",
		label: "Test",
		bbox: [37.70, -122.53, 37.84, -122.28],
		generated: "2026-06-28T00:00:00.000Z"
	});

	test("keeps only drivable ways with >=2 nodes", () => {
		expect(asset.ways.map(w => w.id)).toEqual([10, 537838948]); // sorted by id; footway + 1-node dropped
		expect(asset.meta.wayCount).toBe(2);
	});

	test("retains bridge/layer/lanes/oneway + ordered nodes on the bridge way", () => {
		const ggb = asset.ways.find(w => w.id === 537838948)!;
		expect(ggb.highway).toBe("motorway");
		expect(ggb.bridge).toBe(true);
		expect(ggb.layer).toBe(1);
		expect(ggb.lanes).toBe(6);
		expect(ggb.oneway).toBe(true);
		expect(ggb.nodes).toEqual([1, 2, 3]); // ordered, preserved
	});

	test("a plain road carries no bridge/layer/oneway flags", () => {
		const res = asset.ways.find(w => w.id === 10)!;
		expect(res.bridge).toBeUndefined();
		expect(res.tunnel).toBeUndefined();
		expect(res.layer).toBeUndefined();
		expect(res.oneway).toBeUndefined();
	});

	test("node table is deduped + holds only referenced nodes (junction node once, unused excluded)", () => {
		const ids = Object.keys(asset.nodes).map(Number).sort((a, b) => a - b);
		expect(ids).toEqual([1, 2, 3, 4]); // 5/6 belonged only to the dropped footway; 99 unreferenced
		expect(asset.nodes[3]).toEqual([37.8110, -122.4120]);
		expect(asset.meta.nodeCount).toBe(4);
	});

	test("shared node id expresses adjacency (the routing junction)", () => {
		const waysAtNode3 = asset.ways.filter(w => w.nodes.includes(3)).map(w => w.id).sort((a, b) => a - b);
		expect(waysAtNode3).toEqual([10, 537838948]); // both meet at node 3 => a junction
	});

	test("geometry is raw WGS84 lat/lon (no projection baked in)", () => {
		expect(asset.nodes[1]).toEqual([37.8094, -122.4108]);
	});

	test("meta carries region/bbox/attribution", () => {
		expect(asset.meta.region).toBe("test");
		expect(asset.meta.bbox).toEqual([37.70, -122.53, 37.84, -122.28]);
		expect(asset.meta.attribution).toContain("OpenStreetMap");
	});

	test("a fully-recursed query leaves no way with missing node coords", () => {
		expect(waysWithMissingNodes(asset)).toEqual([]);
	});

	test("a way referencing an absent node is flagged by waysWithMissingNodes", () => {
		const broken = assembleRoadGraph(
			[{type: "way", id: 1, nodes: [1, 2], tags: {highway: "residential"}}, {type: "node", id: 1, lat: 1, lon: 1}],
			{region: "x", label: "x", bbox: [0, 0, 1, 1]}
		);
		expect(waysWithMissingNodes(broken)).toEqual([1]); // node 2 never returned
	});

	test("DRIVABLE_HIGHWAYS covers the expected classes", () => {
		expect(DRIVABLE_HIGHWAYS.has("motorway")).toBe(true);
		expect(DRIVABLE_HIGHWAYS.has("service")).toBe(true);
		expect(DRIVABLE_HIGHWAYS.has("footway")).toBe(false);
	});
});

describe("frame-E projection (P2 overlay)", () => {
	// The whole P2 alignment story rests on the overlay projecting nodes EXACTLY as the engine projects
	// the rendered roads. latLonToFrameE is an inline copy of MathUtils.degrees2meters; pin them equal so
	// the copy can never silently drift from the engine projection.
	test("latLonToFrameE is identical to MathUtils.degrees2meters", () => {
		const coords: [number, number][] = [
			[37.8094, -122.4108],  // SF
			[37.8327, -122.4818],  // GGB north approach
			[0, 0],
			[51.5074, -0.1278],    // London (any city — no SF hardcoding)
			[-33.8688, 151.2093],  // Sydney (southern hemisphere)
		];

		for (const [lat, lon] of coords) {
			const m = MathUtils.degrees2meters(lat, lon);
			const [x, z] = latLonToFrameE(lat, lon);
			expect(x).toBeCloseTo(m.x, 6); // X from lat
			expect(z).toBeCloseTo(m.y, 6); // Z from lon (Vec2.y holds the mercator z)
		}
	});

	test("roadGraphToFrameEPolylines resolves ordered nodes through the table", () => {
		const asset: RoadGraphAsset = {
			meta: {region: "x", label: "x", bbox: [0, 0, 1, 1], generated: "t", attribution: "a", nodeCount: 3, wayCount: 1},
			nodes: {1: [37.81, -122.41], 2: [37.82, -122.42], 3: [37.83, -122.43]},
			ways: [{id: 7, nodes: [1, 2, 3], highway: "motorway"}],
		};

		const lines = roadGraphToFrameEPolylines(asset);
		expect(lines).toHaveLength(1);
		expect(lines[0].id).toBe(7);
		expect(lines[0].points).toHaveLength(3);
		expect(lines[0].points[0]).toEqual(latLonToFrameE(37.81, -122.41)); // ordered + projected
	});

	test("drops a way left with <2 resolvable points (missing node coords)", () => {
		const asset: RoadGraphAsset = {
			meta: {region: "x", label: "x", bbox: [0, 0, 1, 1], generated: "t", attribution: "a", nodeCount: 1, wayCount: 1},
			nodes: {1: [37.81, -122.41]},                       // node 2 absent
			ways: [{id: 7, nodes: [1, 2], highway: "service"}],
		};

		expect(roadGraphToFrameEPolylines(asset)).toEqual([]);
	});
});
