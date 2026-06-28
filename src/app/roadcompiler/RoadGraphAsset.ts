// Road-compiler: the canonical CLEAN road-graph asset (roadmap §0.5 s24 redirect, §1.5, §8).
//
// The streets.gl PBF render tiles clip + simplify roads per tile, so a single OSM way arrives as
// scattered fragments — unusable as a continuous, routable centerline (the s24 root-cause). This asset
// is the clean alternative: ONE offline Overpass query for all drivable roads in a bbox, emitted as a
// node-deduplicated graph — every way's ORDERED osm node ids + a shared node->coord table + the
// bridge/tunnel/layer/lanes/oneway tags the PBF strips.
//
// Geometry is stored as RAW WGS84 [lat, lon] (NO projection baked in) so the asset is consumer-agnostic
// (roadmap §0.6) — any engine (Strata, BeamNG, ...) applies its own projection. Strata converts each node
// via MathUtils.degrees2meters into frame E ([X = from lat, Z = from lon] — CorridorSuppression.ts) at
// load, the SAME projection the rendered roads use, so the graph aligns with the streets-gl roads BY
// CONSTRUCTION (no new alignment logic). Sharing a node id between two ways IS a junction — the routable
// adjacency (P3 autodrive / GPS) falls out for free.
//
// This module is PURE: no `~/` aliases, no engine deps — so the offline generator
// (scripts/genRoadGraph.mjs, run under Node) imports the EXACT SAME builder that jest pins, single-source.
// Unit-tested in RoadGraphAsset.test.ts.

/** A raw OSM node coordinate, WGS84: [lat, lon]. */
export type LatLon = [number, number];

/** One drivable road, graph-native: ordered osm node ids + the tags the PBF strips. */
export interface RoadGraphWay {
	/** OSM way id. */
	id: number;
	/** ORDERED osm node ids. Geometry = these resolved through the asset's `nodes` table.
	 *  A node id shared with another way is a junction (the routing-graph adjacency key). */
	nodes: number[];
	/** OSM `highway=*` road class (motorway / residential / service / ...). */
	highway: string;
	/** `bridge=*` (any non-`no`) → elevated. Only present when tagged. */
	bridge?: boolean;
	/** `tunnel=*` (any non-`no`) → below grade. Only present when tagged. */
	tunnel?: boolean;
	/** OSM `layer=*` ordinal (relative stacking order, NOT absolute height — roadmap §1.1). Only when tagged. */
	layer?: number;
	/** `lanes=*`, when tagged. */
	lanes?: number;
	/** `oneway=*` → true only for an actual oneway (incl. reversed `-1`). Routing direction (P3). */
	oneway?: boolean;
}

export interface RoadGraphMeta {
	/** Region slug (e.g. "sf") or the `--name` passed for an ad-hoc bbox. */
	region: string;
	/** Human label. */
	label: string;
	/** Query bbox [south, west, north, east] — the seed for later location-based slicing (GPS-style load). */
	bbox: [number, number, number, number];
	/** ISO timestamp of generation. */
	generated: string;
	/** ODbL attribution (roadmap §5). */
	attribution: string;
	nodeCount: number;
	wayCount: number;
}

/** The clean road-graph asset for one region. Nodes are deduped: each referenced node appears once. */
export interface RoadGraphAsset {
	meta: RoadGraphMeta;
	/** osm node id -> [lat, lon] (WGS84). Holds only nodes referenced by a kept way. */
	nodes: Record<number, LatLon>;
	ways: RoadGraphWay[];
}

/** The drivable network only — footway/cycleway/path/steps are real OSM ways but irrelevant to driving,
 *  and dropping them keeps the asset small. (Mirrors the bridge sidecar's filter.) */
export const DRIVABLE_HIGHWAYS: ReadonlySet<string> = new Set([
	"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
	"living_street", "motorway_link", "trunk_link", "primary_link", "secondary_link",
	"tertiary_link", "service"
]);

/** Parse an OSM `layer` value ("1", "-1", "1;2") → integer, or undefined when absent/unparseable. */
export function parseLayer(raw: unknown): number | undefined {
	if (raw === undefined || raw === null || raw === "") {
		return undefined;
	}
	const m = String(raw).match(/-?\d+/);
	return m ? parseInt(m[0], 10) : undefined;
}

/** Parse an OSM `lanes` value → positive integer, or undefined. */
export function parseLanes(raw: unknown): number | undefined {
	if (raw === undefined || raw === null) {
		return undefined;
	}
	const m = String(raw).match(/\d+/);
	return m ? parseInt(m[0], 10) : undefined;
}

/** Parse an OSM `oneway` value → true for an actual oneway (incl. reversed `-1`), else undefined.
 *  Direction-of-traversal handling (the `-1` reversal) is deferred to P3 routing; here it's just a flag. */
export function parseOneway(raw: unknown): boolean | undefined {
	if (raw === undefined || raw === null) {
		return undefined;
	}
	const v = String(raw).toLowerCase().trim();
	if (v === "yes" || v === "true" || v === "1" || v === "-1") {
		return true;
	}
	return undefined;
}

/** A minimal shape of an Overpass element (way or node) — what `out body;` + `out skel qt;` returns. */
export interface OverpassElement {
	type: string;
	id: number;
	lat?: number;
	lon?: number;
	nodes?: number[];
	tags?: Record<string, string>;
}

export interface AssembleOptions {
	region: string;
	label: string;
	bbox: [number, number, number, number];
	/** Defaults to ISO now. */
	generated?: string;
	/** Defaults to DRIVABLE_HIGHWAYS. */
	drivable?: ReadonlySet<string>;
}

/**
 * Pure transform: Overpass elements → the clean RoadGraphAsset.
 *
 * Input is the result of `way[highway](bbox); out body; >; out skel qt;` — ways carry ordered node-id
 * lists + tags (`out body`), and `>;` + `out skel` returns every referenced node's id+lat+lon, INCLUDING
 * nodes past the bbox edge (so a way is never clipped — the whole point of the redirect vs render tiles).
 *
 * Keeps only drivable highway ways with ≥2 nodes; the node table holds ONLY nodes a kept way references.
 * Ways sorted by id for a stable, diffable asset.
 */
export function assembleRoadGraph(elements: readonly OverpassElement[], opts: AssembleOptions): RoadGraphAsset {
	const drivable = opts.drivable ?? DRIVABLE_HIGHWAYS;

	const nodeCoords = new Map<number, LatLon>();
	for (const el of elements) {
		if (el.type === "node" && typeof el.lat === "number" && typeof el.lon === "number") {
			nodeCoords.set(el.id, [el.lat, el.lon]);
		}
	}

	const ways: RoadGraphWay[] = [];
	const usedNodes = new Set<number>();

	for (const el of elements) {
		if (el.type !== "way") {
			continue;
		}
		const t = el.tags ?? {};
		const highway = t.highway;
		if (!highway || !drivable.has(highway)) {
			continue;
		}
		const nodeIds = el.nodes ?? [];
		if (nodeIds.length < 2) {
			continue;
		}

		const way: RoadGraphWay = {id: el.id, nodes: [...nodeIds], highway};
		if (t.bridge && t.bridge !== "no") {
			way.bridge = true;
		}
		if (t.tunnel && t.tunnel !== "no") {
			way.tunnel = true;
		}
		const layer = parseLayer(t.layer);
		if (layer !== undefined) {
			way.layer = layer;
		}
		const lanes = parseLanes(t.lanes);
		if (lanes !== undefined) {
			way.lanes = lanes;
		}
		const oneway = parseOneway(t.oneway);
		if (oneway !== undefined) {
			way.oneway = oneway;
		}

		ways.push(way);
		for (const n of nodeIds) {
			usedNodes.add(n);
		}
	}

	const nodes: Record<number, LatLon> = {};
	for (const id of usedNodes) {
		const c = nodeCoords.get(id);
		if (c) {
			nodes[id] = c;
		}
	}

	ways.sort((a, b) => a.id - b.id);

	return {
		meta: {
			region: opts.region,
			label: opts.label,
			bbox: opts.bbox,
			generated: opts.generated ?? new Date().toISOString(),
			attribution: "© OpenStreetMap contributors (ODbL)",
			nodeCount: Object.keys(nodes).length,
			wayCount: ways.length
		},
		nodes,
		ways
	};
}

/** Way ids whose geometry can't be fully resolved (a node missing from the table). Should be empty for a
 *  `>;`-recursed query; the generator logs any so a bad fetch is visible. Pure helper for tests + CLI. */
export function waysWithMissingNodes(asset: RoadGraphAsset): number[] {
	const out: number[] = [];
	for (const way of asset.ways) {
		if (way.nodes.some(n => asset.nodes[n] === undefined)) {
			out.push(way.id);
		}
	}
	return out;
}
