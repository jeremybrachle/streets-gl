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

// ---------------------------------------------------------------------------------------------------
// Frame-E projection (P2 overlay). Strata renders in "frame E" = web-mercator meters centered at 0,
// [X derived from lat, Z derived from lon] — the SAME frame the car drives in and the GGB corridor /
// CorridorSuppression use. To keep this module PURE (the Node generator imports it, so no `~/` engine
// deps), the projection is an INLINE copy of MathUtils.degrees2meters — NOT a second projection. The
// unit test pins latLonToFrameE exactly equal to MathUtils.degrees2meters so the copy can never drift.

const MERCATOR_HALF_EXTENT = 20037508.34; // = WORLD_SIZE / 2, the degrees2meters scale constant

/** One drivable road as a frame-E polyline (mercator meters), ready to drape/draw. */
export interface FrameEWayPolyline {
	/** OSM way id (carried through so the overlay can key back to the graph). */
	id: number;
	/** Ordered [X, Z] mercator-meter points; X from lat, Z from lon. */
	points: [number, number][];
}

/**
 * Project a WGS84 [lat, lon] into Strata frame E ([X from lat, Z from lon], mercator meters).
 * Inline mirror of MathUtils.degrees2meters (kept here to preserve this module's purity); pinned equal
 * to it in RoadGraphAsset.test.ts. This is the ONLY projection — no new alignment logic.
 */
export function latLonToFrameE(lat: number, lon: number): [number, number] {
	const z = lon * MERCATOR_HALF_EXTENT / 180;
	const x = Math.log(Math.tan((90 + lat) * Math.PI / 360)) * MERCATOR_HALF_EXTENT / Math.PI;
	return [x, z];
}

/**
 * Resolve every way's ordered node ids through the asset's node table and project to frame E.
 * Ways whose geometry drops below 2 resolvable points are skipped (can't draw a line). Pure — the
 * P2 main-thread overlay loader calls this once per loaded asset.
 */
export function roadGraphToFrameEPolylines(asset: RoadGraphAsset): FrameEWayPolyline[] {
	const out: FrameEWayPolyline[] = [];

	for (const way of asset.ways) {
		const points: [number, number][] = [];

		for (const nodeId of way.nodes) {
			const c = asset.nodes[nodeId];
			if (c) {
				points.push(latLonToFrameE(c[0], c[1]));
			}
		}

		if (points.length >= 2) {
			out.push({id: way.id, points});
		}
	}

	return out;
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

// ---------------------------------------------------------------------------------------------------
// Dynamic in-browser fetch helpers (P2.5). The browser loads a not-yet-bundled city's graph on demand
// with the SAME 3 steps as scripts/genRoadGraph.mjs: build the Overpass query for a BOUNDED bbox around
// the searched/driven point → fetch → assembleRoadGraph → project. These are pure so both the CLI and the
// browser single-source them (no drift). A bbox is [south, west, north, east] (WGS84 degrees).

export type Bbox = [number, number, number, number];

/** ~meters per degree of latitude (spherical-earth approx; good enough for a few-km verification box). */
const METERS_PER_DEG_LAT = 111320;

/**
 * A bounded bbox of ±halfMeters around (lat, lon) — the "few km around the target" the dynamic fetch
 * queries (SF-wide was 8 MB; a ~6 km box is a fraction of that). Longitude degrees are scaled by cos(lat)
 * so the box stays roughly square in meters at any latitude. Returns [south, west, north, east].
 */
export function bboxAround(lat: number, lon: number, halfMeters: number): Bbox {
	const dLat = halfMeters / METERS_PER_DEG_LAT;
	const cos = Math.max(0.01, Math.cos(lat * Math.PI / 180)); // guard the poles
	const dLon = halfMeters / (METERS_PER_DEG_LAT * cos);
	return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

/** True if (lat, lon) lies inside bbox [south, west, north, east]. Used to skip re-fetching an area we
 *  already loaded and to pick a bundled region that actually contains the camera. */
export function bboxContains(bbox: Bbox, lat: number, lon: number): boolean {
	const [s, w, n, e] = bbox;
	return lat >= s && lat <= n && lon >= w && lon <= e;
}

/**
 * Snap (lat, lon) to a fixed degree grid so nearby toggles/searches bucket to ONE cache entry (and one
 * fetched area), instead of re-querying Overpass for every slightly-different point. The dynamic bbox is
 * built around the snapped center, so the cache key and the fetched extent always correspond.
 */
export function snapToAreaGrid(lat: number, lon: number, gridDeg: number): [number, number] {
	return [Math.round(lat / gridDeg) * gridDeg, Math.round(lon / gridDeg) * gridDeg];
}

/** Stable cache/area key for a snapped grid center — the IndexedDB / in-memory key for a fetched area. */
export function areaKey(gridLat: number, gridLon: number): string {
	return `roadgraph:${gridLat.toFixed(4)},${gridLon.toFixed(4)}`;
}

/**
 * The Overpass QL query for all drivable roads in a bbox — the SINGLE SOURCE shared by the browser fetch
 * and scripts/genRoadGraph.mjs. `out body;` gives ways with ordered node-id lists + tags; `>;` selects
 * every referenced node (even past the bbox edge → ways are never clipped); `out skel qt;` gives node
 * id+lat+lon. bbox = [south, west, north, east].
 */
export function buildOverpassRoadQuery(bbox: Bbox): string {
	const [s, w, n, e] = bbox;
	return `[out:json][timeout:180];
way[highway](${s},${w},${n},${e});
out body;
>;
out skel qt;`;
}
