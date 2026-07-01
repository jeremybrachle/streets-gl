// Road-graph overlay loader (P2 alignment gate → P2.5 dynamic in-browser load). Main-thread singleton
// that supplies the clean OSM road graph (frame-E polylines) the overlay draws over the streets-gl roads.
//
// THREE TIERS of "get the graph for wherever I am" (roadmap §1.5 / §C):
//  1. BUNDLED favorites (SF today) — a REGIONS entry with a dynamic import() of its generated JSON.
//     webpack code-splits it into a lazy chunk → loads INSTANTLY, ZERO API. Add a favorite = run the CLI
//     once + one REGIONS line. This is the long-term direction (pre-baked, served from our own backend).
//  2. DYNAMIC on-demand (P2.5) — for any city NOT bundled, fetch a BOUNDED bbox of clean roads straight
//     from Overpass in the browser (the SAME 3 steps as scripts/genRoadGraph.mjs: buildOverpassRoadQuery →
//     fetch → assembleRoadGraph), project, and draw it. Fires only on a DISCRETE trigger (toggle-on /
//     navigate) via `requestPending`, never continuously while driving (roadmap §5: no live API in the
//     hot path — this is the dev/verification fetch the user OK'd).
//  3. CACHE (RoadGraphCache) — a fetched area is kept in IndexedDB + memory, so a revisit is instant and
//     never re-hits Overpass.
//
// The projection (roadGraphToFrameEPolylines) is the SAME mercator as the rendered roads / GGB corridor,
// so alignment holds by construction (see RoadGraphAsset.latLonToFrameE, pinned == MathUtils.degrees2meters).

import {
	RoadGraphAsset,
	FrameEWayPolyline,
	Bbox,
	roadGraphToFrameEPolylines,
	assembleRoadGraph,
	bboxAround,
	bboxContains,
	snapToAreaGrid,
	areaKey,
	buildOverpassRoadQuery
} from "./RoadGraphAsset";
import {cacheGet, cachePut} from "./RoadGraphCache";
import {RoutingGraph, buildRoutingGraph} from "./RoadRouter";
import MathUtils from "~/lib/math/MathUtils";
import Config from "~/app/Config";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

/** A bundled city: its query bbox (to auto-select by camera location) + a lazy loader for its graph JSON. */
interface RegionEntry {
	slug: string;
	/** [south, west, north, east] — the same bbox the asset was generated with. */
	bbox: Bbox;
	/** Dynamic import() => a lazy webpack chunk holding the (multi-MB) RoadGraphAsset JSON. */
	load: () => Promise<RoadGraphAsset>;
}

// The bundled cities. Add a city: generate its JSON (scripts/genRoadGraph.mjs --bbox … --name X) and add
// one entry here with the matching bbox + an import() of the generated file. Everything else (any city you
// search/drive to that ISN'T here) is fetched dynamically at runtime.
const REGIONS: RegionEntry[] = [
	{
		slug: "sf",
		bbox: [37.70, -122.53, 37.84, -122.28],
		load: async (): Promise<RoadGraphAsset> => (await import(
			/* webpackChunkName: "roadgraph-sf" */
			"~/lib/tile-processing/vector/sidecar/sfRoadGraph.generated.json"
		)).default as unknown as RoadGraphAsset,
	},
];

async function fetchOverpass(query: string): Promise<{elements: unknown[]}> {
	// Overpass is flaky under load (we hit a transient 504 generating SF) — retry the retryable statuses
	// with a short backoff before giving up.
	const RETRYABLE = new Set([429, 502, 503, 504]);
	const attempts = 3;
	let lastStatus = 0;

	for (let i = 0; i < attempts; i++) {
		const res = await fetch(OVERPASS_ENDPOINT, {
			method: "POST",
			// Overpass 406s on some default clients; a browser sends its own User-Agent (can't be overridden
			// from fetch), and an explicit Accept keeps the response JSON.
			headers: {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
			body: "data=" + encodeURIComponent(query)
		});

		if (res.ok) {
			return res.json();
		}

		lastStatus = res.status;
		if (!RETRYABLE.has(res.status) || i === attempts - 1) {
			throw new Error(`Overpass ${res.status}`);
		}

		await new Promise(r => setTimeout(r, 1500 * (i + 1)));
	}

	throw new Error(`Overpass unavailable (${lastStatus})`);
}

class RoadGraphOverlayRegistry {
	/** Toggle state — the keystroke flips this; the render pass draws only when visible + ready. */
	public visible = false;
	/** Bumps whenever frameEPolylines is replaced (a new area loaded) — the mesh's rebuild trigger. */
	public revision = 0;
	/** key of the area currently projected: a bundled region slug OR a dynamic area key, null before load. */
	public loadedKey: string | null = null;
	/** The loaded area's [S,W,N,E] — so ensureForCamera can skip work while the camera stays inside it. */
	public loadedBbox: Bbox | null = null;
	/** The loaded roads projected to frame E ([X from lat, Z from lon]) — what the overlay draws. */
	public frameEPolylines: FrameEWayPolyline[] = [];

	/** The RAW loaded asset — retained so routing (A*) can read the node-id adjacency the projected
	 *  frameEPolylines drop. Null before the first load. The overlay/minimap don't need it; the router does. */
	public asset: RoadGraphAsset | null = null;
	/** Lazily-built routable graph derived from `asset` (nodeById + adjacency), rebuilt when `revision`
	 *  advances. Built on first `routingGraph` access, NOT on every overlay load — only a route query
	 *  needs it, and building the SF graph (~130k nodes) is wasted work when nobody is routing. */
	private routingGraphCache: RoutingGraph | null = null;
	private routingGraphRevision = -1;

	/** A load (bundled import or Overpass fetch) is in flight — the "loading road graph…" indicator reads this. */
	public loading = false;
	/** Human label for the indicator while loading (e.g. the area being fetched). */
	public loadingLabel = "";
	/** Last load error message (shown briefly in the indicator), or null. */
	public lastError: string | null = null;

	/** Set by a DISCRETE user action (toggle-on / navigate) to authorize ONE dynamic fetch for the current
	 *  location. Never set per-frame — so the overlay never streams new areas as you drive (roadmap §5). */
	private requestPending = false;

	/** True once an area's graph is loaded and projected (the render pass needs this before drawing). */
	public get ready(): boolean {
		return this.frameEPolylines.length > 0;
	}

	/** The routable graph for the currently-loaded area, or null if nothing is loaded. Built lazily on
	 *  first access and cached until the next area load (revision bump) — routing (GPS) reads this. */
	public get routingGraph(): RoutingGraph | null {
		if (!this.asset) {
			return null;
		}
		if (this.routingGraphCache && this.routingGraphRevision === this.revision) {
			return this.routingGraphCache;
		}
		this.routingGraphCache = buildRoutingGraph(this.asset);
		this.routingGraphRevision = this.revision;
		return this.routingGraphCache;
	}

	/** Flip overlay visibility (the keystroke). Turning it ON authorizes a fetch for wherever the camera is
	 *  (the render pass calls ensureForCamera with the live camera position while visible). */
	public toggleVisible(): void {
		this.visible = !this.visible;
		if (this.visible) {
			this.requestPending = true;
		}
	}

	/** Called on a discrete navigate (search-result click / geolocation) so that, if the overlay is on, the
	 *  next visible frame loads the graph for the new location. Cheap + does NO I/O itself — if the overlay
	 *  is hidden nothing fetches until it's next toggled on. */
	public markDirty(): void {
		this.requestPending = true;
	}

	private bundledRegionContaining(lat: number, lon: number): RegionEntry | null {
		for (const r of REGIONS) {
			if (bboxContains(r.bbox, lat, lon)) {
				return r;
			}
		}
		return null;
	}

	/** Load the graph for the camera's location if needed. camX/camZ = frame-E position (mercator meters).
	 *  Called each visible frame; cheap no-op once the right area is loaded.
	 *  - A bundled region containing the camera loads instantly (zero API) and always wins.
	 *  - Otherwise, if a discrete trigger is pending, fetch the un-bundled area from Overpass (once). */
	public ensureForCamera(camX: number, camZ: number): void {
		if (this.loading) {
			return;
		}

		const {lat, lon} = MathUtils.meters2degrees(camX, camZ);

		// 1) Bundled favorite that actually contains the camera → instant lazy chunk (no fallback-to-first:
		//    that would clobber a dynamically-fetched city the moment the camera left SF's bbox).
		const bundled = this.bundledRegionContaining(lat, lon);
		if (bundled) {
			if (this.loadedKey !== bundled.slug) {
				this.loadBundled(bundled);
			}
			this.requestPending = false;
			return;
		}

		// 2) Already inside the dynamically-loaded area → nothing to do.
		if (this.loadedBbox && bboxContains(this.loadedBbox, lat, lon)) {
			this.requestPending = false;
			return;
		}

		// 3) Un-bundled + uncovered. Fetch only on a discrete trigger (never as a side effect of driving).
		if (this.requestPending) {
			this.requestPending = false;
			this.requestDynamicArea(lat, lon);
		}
	}

	private loadBundled(region: RegionEntry): void {
		this.loading = true;
		this.loadingLabel = region.slug.toUpperCase();
		this.lastError = null;

		region.load().then(asset => {
			this.applyAsset(asset, region.slug, region.bbox);
			console.log(`[Strata] road-graph overlay: loaded bundled "${region.slug}" — ${this.frameEPolylines.length} ways`);
		}).catch(err => {
			this.loading = false;
			this.lastError = `bundled ${region.slug} failed`;
			console.error(`[Strata] road-graph overlay: failed to load bundled "${region.slug}"`, err);
		});
	}

	/** Fetch (or load from cache) the clean road graph for the un-bundled area under the camera. Same 3
	 *  steps as the CLI: buildOverpassRoadQuery → fetch → assembleRoadGraph; then project + cache. */
	private requestDynamicArea(lat: number, lon: number): void {
		const [gLat, gLon] = snapToAreaGrid(lat, lon, Config.RoadGraphAreaGridDeg);
		const key = areaKey(gLat, gLon);

		if (this.loadedKey === key) {
			return;
		}

		const bbox = bboxAround(gLat, gLon, Config.RoadGraphDynamicHalfExtentMeters);

		this.loading = true;
		this.loadingLabel = `${gLat.toFixed(3)}, ${gLon.toFixed(3)}`;
		this.lastError = null;

		this.fetchArea(key, bbox).then(asset => {
			this.applyAsset(asset, key, bbox);
			console.log(`[Strata] road-graph overlay: loaded area ${key} — ${this.frameEPolylines.length} ways, ${Object.keys(asset.nodes).length} nodes`);
		}).catch(err => {
			this.loading = false;
			this.lastError = String(err?.message ?? err);
			console.error(`[Strata] road-graph overlay: failed to fetch area ${key}`, err);
		});
	}

	private async fetchArea(key: string, bbox: Bbox): Promise<RoadGraphAsset> {
		const cached = await cacheGet(key);
		if (cached) {
			console.log(`[Strata] road-graph overlay: cache hit ${key}`);
			return cached;
		}

		const query = buildOverpassRoadQuery(bbox);
		const data = await fetchOverpass(query);
		const asset = assembleRoadGraph(data.elements as never, {
			region: key,
			label: `Overpass ${bbox.map(v => v.toFixed(3)).join(",")}`,
			bbox
		});
		await cachePut(key, asset);
		return asset;
	}

	private applyAsset(asset: RoadGraphAsset, key: string, bbox: Bbox): void {
		this.frameEPolylines = roadGraphToFrameEPolylines(asset);
		this.asset = asset; // retained for routing (A*); the routingGraph getter rebuilds off the new revision
		this.loadedKey = key;
		this.loadedBbox = bbox;
		this.revision++;
		this.loading = false;
	}
}

/** Process-wide singleton (mirrors editableRoadRegistry / bridgeRegistry). */
export const roadGraphOverlay = new RoadGraphOverlayRegistry();
