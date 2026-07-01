// Road-compiler: the ACTIVE GPS ROUTE (snap-to-drive, roadmap §0.7). A main-thread singleton holding the
// one route the player has picked — start (car), destination, and the A* path as a frame-E polyline — so
// the world overlay (RouteOverlayMesh), the minimap, and the full-screen map all read ONE source.
//
// It is thin engine glue over the pure core: it reads the loaded routable graph from roadGraphOverlay
// (RoadGraphOverlayRegistry.routingGraph) and runs routeBetween (RoadRouter) — the A* + snap logic that is
// already unit-tested. No projection or routing math lives here; this only owns the current-route STATE
// (mirrors roadGraphOverlay / bridgeRegistry). Coordinates are frame E (mercator meters), the SAME space
// as the car, the minimap, and the graph — so the polyline plots into all of them with no extra transform.
//
// `visible` is toggled by KeyP and gates ONLY the yellow world overlay — independent of the KeyO all-roads
// overlay (roadGraphOverlay.visible). The minimap/map draw the route whenever one exists.

import {roadGraphOverlay} from "./RoadGraphOverlayRegistry";
import {routeBetween} from "./RoadRouter";

class RouteRegistry {
	/** KeyP toggles this — gates the yellow route ribbon in the 3D world (NOT the KeyO overlay). */
	public visible = false;
	/** Frame-E start (the car position at route time) and destination, kept for drawing the end markers. */
	public start: [number, number] | null = null;
	public destination: [number, number] | null = null;
	/** The A* route as an ordered frame-E polyline ([X, Z] mercator meters) — what everything draws. */
	public routePolyline: [number, number][] = [];
	/** The ordered graph node ids of the route (for autodrive follow, later). */
	public routeNodeIds: number[] = [];
	/** Bumps whenever the route changes — the mesh's rebuild trigger + the map/minimap redraw signal. */
	public revision = 0;
	/** Set when a route request produced no path (no graph loaded / unreachable), else null. */
	public lastError: string | null = null;

	/** True once a drawable route exists. */
	public get hasRoute(): boolean {
		return this.routePolyline.length >= 2;
	}

	/** Flip the yellow world-overlay visibility (KeyP). */
	public toggleVisible(): void {
		this.visible = !this.visible;
	}

	/**
	 * Compute + store the route from a frame-E start (the car) to a frame-E destination, over the currently
	 * loaded routable graph. Both endpoints snap to the nearest graph node (RoadRouter.nearestNode) inside
	 * routeBetween. On failure the polyline is cleared and `lastError` explains why (so the UI can show it).
	 */
	public setRoute(startX: number, startZ: number, destX: number, destZ: number): void {
		this.start = [startX, startZ];
		this.destination = [destX, destZ];

		const graph = roadGraphOverlay.routingGraph;
		if (!graph) {
			this.failRoute("road graph not loaded yet");
			return;
		}

		const res = routeBetween(graph, startX, startZ, destX, destZ);
		if (!res) {
			this.failRoute("no route found");
			return;
		}

		this.routePolyline = res.polyline;
		this.routeNodeIds = res.nodeIds;
		this.lastError = null;
		this.revision++;
	}

	/** Drop the current route (markers + path). */
	public clear(): void {
		this.start = null;
		this.destination = null;
		this.routePolyline = [];
		this.routeNodeIds = [];
		this.lastError = null;
		this.revision++;
	}

	private failRoute(message: string): void {
		this.routePolyline = [];
		this.routeNodeIds = [];
		this.lastError = message;
		this.revision++;
	}
}

/** Process-wide singleton (mirrors roadGraphOverlay). */
export const routeRegistry = new RouteRegistry();
