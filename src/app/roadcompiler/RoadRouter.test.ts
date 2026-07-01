import {
	buildRoutingGraph,
	nearestNode,
	aStar,
	routeToFrameEPolyline,
	routeBetween,
	RoutingGraph
} from "./RoadRouter";
import {RoadGraphAsset, latLonToFrameE} from "./RoadGraphAsset";

// A tiny hand-built asset shaped like an H:
//
//   1 --wayA-- 2 --wayA-- 3        (wayA: 1-2-3, a horizontal road; node 2 is its middle)
//                         |
//   4 --wayB-- 5 --wayB-- 6        (wayB: 4-5-6, another horizontal road)
//                         |
//   node 3 and node 6 are joined by wayC (3-6, the vertical bar). So 3 and 6 are junctions.
//
// Node 9 is isolated (its own way to node 8) — a separate component, unreachable from 1.
//
// Coordinates are picked so frame-E X/Z are monotonic in lat/lon and distances are sane; exact meters
// don't matter (the router only compares them), so we assert topology + optimality, not absolute lengths.
function makeAsset(): RoadGraphAsset {
	return {
		meta: {
			region: "test", label: "test", bbox: [0, 0, 1, 1],
			generated: "2026-07-01T00:00:00Z", attribution: "test", nodeCount: 8, wayCount: 5
		},
		nodes: {
			1: [0.000, 0.000],
			2: [0.000, 0.010],
			3: [0.000, 0.020],
			4: [-0.020, 0.000],
			5: [-0.020, 0.010],
			6: [-0.020, 0.020],
			8: [0.500, 0.500],
			9: [0.500, 0.510]
		},
		ways: [
			{id: 100, nodes: [1, 2, 3], highway: "residential"},
			{id: 200, nodes: [4, 5, 6], highway: "residential"},
			{id: 300, nodes: [3, 6], highway: "residential"}, // the vertical bar joining the two roads
			{id: 900, nodes: [8, 9], highway: "service"} // isolated component
		]
	};
}

describe("buildRoutingGraph", () => {
	test("projects every referenced node to frame E and matches latLonToFrameE", () => {
		const g = buildRoutingGraph(makeAsset());
		expect(g.nodeById.size).toBe(8);
		const [x, z] = latLonToFrameE(0.0, 0.02);
		expect(g.nodeById.get(3)).toEqual({x, z});
	});

	test("adjacency is undirected and connects shared nodes across ways", () => {
		const g = buildRoutingGraph(makeAsset());
		// node 2 (middle of wayA) neighbours 1 and 3.
		expect(new Set(g.adjacency.get(2)!.map(e => e.to))).toEqual(new Set([1, 3]));
		// node 3 is a junction: neighbour of 2 (wayA) AND 6 (wayC).
		expect(new Set(g.adjacency.get(3)!.map(e => e.to))).toEqual(new Set([2, 6]));
		// undirected: 3->6 implies 6->3.
		expect(g.adjacency.get(6)!.some(e => e.to === 3)).toBe(true);
	});

	test("edge cost is the straight-line frame-E distance", () => {
		const g = buildRoutingGraph(makeAsset());
		const n1 = g.nodeById.get(1)!;
		const n2 = g.nodeById.get(2)!;
		const expected = Math.hypot(n1.x - n2.x, n1.z - n2.z);
		const edge = g.adjacency.get(1)!.find(e => e.to === 2)!;
		expect(edge.cost).toBeCloseTo(expected, 6);
	});
});

describe("nearestNode", () => {
	let g: RoutingGraph;
	beforeEach(() => {
		g = buildRoutingGraph(makeAsset());
	});

	test("returns the closest node to a frame-E point", () => {
		const n3 = g.nodeById.get(3)!;
		// A point a hair off node 3 snaps to 3.
		expect(nearestNode(g, n3.x + 1, n3.z + 1)).toBe(3);
	});

	test("null on an empty graph", () => {
		expect(nearestNode({nodeById: new Map(), adjacency: new Map()}, 0, 0)).toBeNull();
	});
});

describe("aStar", () => {
	let g: RoutingGraph;
	beforeEach(() => {
		g = buildRoutingGraph(makeAsset());
	});

	test("same start and goal → empty path", () => {
		expect(aStar(g, 1, 1)).toEqual([]);
	});

	test("routes along the graph, through the junction bar", () => {
		// 1 -> 4 must go 1,2,3 (wayA) then 3,6 (wayC bar) then 6,5,4 (wayB).
		expect(aStar(g, 1, 4)).toEqual([1, 2, 3, 6, 5, 4]);
	});

	test("adjacent nodes → the two-node path", () => {
		expect(aStar(g, 1, 2)).toEqual([1, 2]);
	});

	test("unreachable (separate component) → null", () => {
		expect(aStar(g, 1, 9)).toBeNull();
	});

	test("unknown endpoint → null", () => {
		expect(aStar(g, 1, 4242)).toBeNull();
	});

	test("path is optimal (lower total cost than any alternative to the same goal)", () => {
		const path = aStar(g, 1, 6)!;
		// Sum the frame-E edge costs along the returned path.
		let cost = 0;
		for (let i = 0; i < path.length - 1; i++) {
			cost += g.adjacency.get(path[i])!.find(e => e.to === path[i + 1])!.cost;
		}
		// The only route 1->6 is 1,2,3,6; assert it's that and the cost is the three edges.
		expect(path).toEqual([1, 2, 3, 6]);
		const direct =
			g.adjacency.get(1)!.find(e => e.to === 2)!.cost +
			g.adjacency.get(2)!.find(e => e.to === 3)!.cost +
			g.adjacency.get(3)!.find(e => e.to === 6)!.cost;
		expect(cost).toBeCloseTo(direct, 6);
	});
});

describe("routeToFrameEPolyline + routeBetween", () => {
	let g: RoutingGraph;
	beforeEach(() => {
		g = buildRoutingGraph(makeAsset());
	});

	test("resolves node ids to their frame-E points in order", () => {
		const poly = routeToFrameEPolyline(g, [1, 2, 3]);
		expect(poly).toEqual([
			[g.nodeById.get(1)!.x, g.nodeById.get(1)!.z],
			[g.nodeById.get(2)!.x, g.nodeById.get(2)!.z],
			[g.nodeById.get(3)!.x, g.nodeById.get(3)!.z]
		]);
	});

	test("routeBetween snaps arbitrary endpoints and returns the polyline + node ids", () => {
		const start = g.nodeById.get(1)!;
		const dest = g.nodeById.get(4)!;
		const res = routeBetween(g, start.x - 2, start.z - 2, dest.x + 2, dest.z + 2)!;
		expect(res.startNodeId).toBe(1);
		expect(res.destNodeId).toBe(4);
		expect(res.nodeIds).toEqual([1, 2, 3, 6, 5, 4]);
		expect(res.polyline.length).toBe(6);
	});

	test("routeBetween returns null when unreachable", () => {
		const start = g.nodeById.get(1)!;
		const iso = g.nodeById.get(9)!;
		expect(routeBetween(g, start.x, start.z, iso.x, iso.z)).toBeNull();
	});
});
