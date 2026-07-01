// Road-compiler: routing over the clean OSM graph (GPS snap-to-drive, roadmap §0.7).
//
// The clean RoadGraphAsset already IS a routable graph — a node id shared between two ways is a junction
// (RoadGraphAsset.ts). This module turns that asset into the adjacency structure A* needs and runs the
// route query. It is a direct port of the proven worlddrive POC (renderer/router.js: aStar + nearestNode),
// adapted to a node-keyed adjacency (our edges are consecutive-node pairs within a way, not a separate
// edge table).
//
// PURE + engine-agnostic (no `~/` aliases, no engine deps): it operates on a RoadGraphAsset and returns
// plain frame-E coordinates via RoadGraphAsset.latLonToFrameE (the ONE projection). Keeping it pure means
// the same router serves Strata's single-vehicle magnet-follow now AND the roads-only / NPC-pathfinding
// lane-constraint later (roadmap §0.7) with zero rework — that generalization is a consumer of this
// module, not a rewrite of it. Unit-tested in RoadRouter.test.ts.
//
// Routing is UNDIRECTED for now (both directions per way): OSM `oneway` is carried on the asset but its
// direction-of-traversal handling is deferred to a later pass (same deferral RoadGraphAsset.parseOneway
// documents). A* cost + heuristic are both straight-line frame-E meters, so the heuristic is admissible.

import {RoadGraphAsset, latLonToFrameE} from "./RoadGraphAsset";

/** A routing node in frame E (web-mercator meters, X from lat / Z from lon) — the SAME frame the car,
 *  the minimap, and the overlay live in, so a route plots into all of them with no extra projection. */
export interface RouteNode {
	x: number;
	z: number;
}

/** One directed adjacency edge: the neighbour node and the traversal cost (frame-E meters). */
export interface RouteEdge {
	to: number;
	cost: number;
}

/** The routable graph derived from a RoadGraphAsset: node positions + undirected adjacency. */
export interface RoutingGraph {
	/** osm node id -> frame-E position. Only nodes referenced by a kept way appear. */
	nodeById: Map<number, RouteNode>;
	/** osm node id -> its neighbours (both directions of every way edge). */
	adjacency: Map<number, RouteEdge[]>;
}

function distance(a: RouteNode, b: RouteNode): number {
	return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Build the routable graph from a clean RoadGraphAsset. Nodes are projected to frame E once; each way's
 * consecutive node pairs become undirected edges (cost = straight-line frame-E distance). An edge is only
 * added when BOTH endpoints resolve (defensive — a `>;`-recursed asset resolves everything, but a partial
 * dynamic fetch might not). Shared nodes across ways connect automatically (that IS the junction).
 */
export function buildRoutingGraph(asset: RoadGraphAsset): RoutingGraph {
	const nodeById = new Map<number, RouteNode>();
	for (const idStr of Object.keys(asset.nodes)) {
		const id = Number(idStr);
		const [lat, lon] = asset.nodes[id];
		const [x, z] = latLonToFrameE(lat, lon);
		nodeById.set(id, {x, z});
	}

	const adjacency = new Map<number, RouteEdge[]>();
	const link = (a: number, b: number, cost: number): void => {
		let list = adjacency.get(a);
		if (!list) {
			list = [];
			adjacency.set(a, list);
		}
		list.push({to: b, cost});
	};

	for (const way of asset.ways) {
		for (let i = 0; i < way.nodes.length - 1; i++) {
			const a = way.nodes[i];
			const b = way.nodes[i + 1];
			const na = nodeById.get(a);
			const nb = nodeById.get(b);
			if (!na || !nb || a === b) {
				continue;
			}
			const cost = distance(na, nb);
			link(a, b, cost);
			link(b, a, cost);
		}
	}

	return {nodeById, adjacency};
}

/**
 * The graph node nearest to frame-E position (x, z), or null if the graph is empty. Linear scan — fine for
 * the occasional route query (POC note: acceptable on ~30k nodes; SF is ~130k, still a few ms, not per
 * frame). Used to snap the route's start (car) and end (destination) onto the graph.
 */
export function nearestNode(graph: RoutingGraph, x: number, z: number): number | null {
	let bestId: number | null = null;
	let bestDist = Infinity;
	for (const [id, node] of graph.nodeById) {
		const d = Math.hypot(node.x - x, node.z - z);
		if (d < bestDist) {
			bestDist = d;
			bestId = id;
		}
	}
	return bestId;
}

/**
 * A* shortest path over the graph. Returns the ORDERED node ids from start to destination (inclusive of
 * both), an empty array when start === destination, or null when unreachable. Cost = summed edge length;
 * heuristic = straight-line frame-E distance to the goal (admissible → optimal). Direct port of the POC's
 * aStar, node-keyed. Linear-scan open-set pop (fine for single route queries; a binary heap is the upgrade
 * if routing ever runs per-frame).
 */
export function aStar(graph: RoutingGraph, fromNodeId: number, toNodeId: number): number[] | null {
	if (fromNodeId === toNodeId) {
		return [];
	}
	const goal = graph.nodeById.get(toNodeId);
	if (!goal || !graph.nodeById.has(fromNodeId)) {
		return null;
	}

	const h = (id: number): number => {
		const n = graph.nodeById.get(id);
		return n ? Math.hypot(n.x - goal.x, n.z - goal.z) : 0;
	};

	interface OpenEntry {
		g: number;
		f: number;
		parent: number | null;
	}

	const open = new Map<number, OpenEntry>();
	const closed = new Map<number, OpenEntry>();
	open.set(fromNodeId, {g: 0, f: h(fromNodeId), parent: null});

	while (open.size > 0) {
		// Pop the lowest-f open node (linear scan).
		let curId = -1;
		let cur: OpenEntry | null = null;
		for (const [id, data] of open) {
			if (cur === null || data.f < cur.f) {
				curId = id;
				cur = data;
			}
		}
		if (cur === null) {
			break;
		}
		open.delete(curId);
		closed.set(curId, cur);

		if (curId === toNodeId) {
			const path: number[] = [];
			let nid: number | null = curId;
			while (nid !== null) {
				path.unshift(nid);
				nid = closed.get(nid)?.parent ?? null;
			}
			return path;
		}

		for (const edge of graph.adjacency.get(curId) ?? []) {
			if (closed.has(edge.to)) {
				continue;
			}
			const g = cur.g + edge.cost;
			const existing = open.get(edge.to);
			if (!existing || g < existing.g) {
				open.set(edge.to, {g, f: g + h(edge.to), parent: curId});
			}
		}
	}

	return null;
}

/** Resolve an ordered node-id route to its frame-E polyline (the minimap / route-follow geometry). Node
 *  ids missing from the table are skipped (shouldn't happen for an A* result — every node came from it). */
export function routeToFrameEPolyline(graph: RoutingGraph, nodeIds: readonly number[]): [number, number][] {
	const out: [number, number][] = [];
	for (const id of nodeIds) {
		const n = graph.nodeById.get(id);
		if (n) {
			out.push([n.x, n.z]);
		}
	}
	return out;
}

/**
 * Convenience: route from an arbitrary frame-E start (the car) to an arbitrary frame-E destination, by
 * snapping each to the nearest graph node and running A*. Returns the route as a frame-E polyline plus the
 * snapped endpoint node ids, or null if either endpoint can't snap or no path exists.
 */
export function routeBetween(
	graph: RoutingGraph,
	startX: number,
	startZ: number,
	destX: number,
	destZ: number
): {nodeIds: number[]; polyline: [number, number][]; startNodeId: number; destNodeId: number} | null {
	const startNodeId = nearestNode(graph, startX, startZ);
	const destNodeId = nearestNode(graph, destX, destZ);
	if (startNodeId === null || destNodeId === null) {
		return null;
	}
	const nodeIds = aStar(graph, startNodeId, destNodeId);
	if (nodeIds === null) {
		return null;
	}
	return {nodeIds, polyline: routeToFrameEPolyline(graph, nodeIds), startNodeId, destNodeId};
}
