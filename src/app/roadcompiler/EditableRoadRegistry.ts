// Road-compiler: the main-thread registry of editable road centerlines (roadmap §0.5 ③, step 2).
//
// Roads are NOT GPU-pickable (PickingSystem is buildings-only), so the height editor picks them on the
// CPU. For that it needs every bridge-tagged road's CENTERLINE on the main thread, in the car/corridor
// frame (frame E — world mercator [X, Z]), addressed by OSM way id. The tile worker tags bridges at
// decode (descriptor.isBridge, Checkpoint ②) and converts their centerlines to frame E; this registry
// collects them as tiles stream in and answers "what road is under this world point?" for click-pick.
//
// Portable + generic: nothing SF/Bay/GGB-specific — any bridge-tagged way that streams in is editable.
// The pick math is `projectPointToPolyline` (already pure + tested in BridgeDeck). Selection state lives
// here so the panel and (later) the highlight renderer read one source of truth, mirroring how
// `bridgeRegistry` is a plain main-thread singleton the physics + panel share.

import {projectPointToPolyline} from "~/app/bridge/BridgeDeck";

/** One bridge-tagged road centerline, ready to edit. Frame E (world mercator [X, Z]), keyed by OSM way.
 *  This is the worker→main payload shape; it must stay plain/serializable (it rides postMessage). */
export interface EditableRoadCenterline {
	osmWayId: number;
	/** Centerline polyline in world mercator meters: [x, z] pairs (the car/corridor frame). */
	centerline: [number, number][];
}

/** Result of a CPU click-pick against the editable roads. */
export interface RoadPick {
	osmWayId: number;
	/** Arc-length (m) of the closest point along the matched centerline segment. */
	s: number;
	/** Perpendicular distance (m) from the query point to the centerline. */
	lateral: number;
	/** The closest point on the centerline, frame E [x, z]. */
	point: [number, number];
	/** Total length (m) of the matched centerline segment that was hit. */
	segmentLength: number;
	/** Summed length (m) of ALL loaded segments sharing this way id — the visible way length. */
	wayLength: number;
}

export class EditableRoadRegistry {
	/** Centerlines grouped by the tile key (`"x,y"`) they streamed in on, so a tile unload drops only
	 *  its own roads. A single OSM way split across tiles appears as one entry per tile (same id). */
	private readonly byTile = new Map<string, EditableRoadCenterline[]>();

	/** The currently selected way (set by click-pick), or null. The panel + highlight read this. */
	public selectedWayId: number | null = null;

	/** Bumped on every ingest/drop/selection change so UI (the panel) can react without deep diffing. */
	public revision = 0;

	/** Register a tile's editable centerlines (replaces any previous set for that tile key). */
	public ingestTile(tileKey: string, roads: readonly EditableRoadCenterline[] | undefined): void {
		if (!roads || roads.length === 0) {
			// Still clear a stale set if the tile reloaded with none.
			if (this.byTile.delete(tileKey)) {
				this.revision++;
			}
			return;
		}
		this.byTile.set(tileKey, roads.map(r => ({osmWayId: r.osmWayId, centerline: r.centerline})));
		this.revision++;
	}

	/** Drop a tile's editable centerlines (on tile unload). */
	public dropTile(tileKey: string): void {
		if (this.byTile.delete(tileKey)) {
			this.revision++;
		}
	}

	public clear(): void {
		this.byTile.clear();
		this.selectedWayId = null;
		this.revision++;
	}

	/** Every loaded centerline segment across all tiles (one way may yield several). */
	public allRoads(): EditableRoadCenterline[] {
		const out: EditableRoadCenterline[] = [];
		for (const roads of this.byTile.values()) {
			out.push(...roads);
		}
		return out;
	}

	public count(): number {
		let n = 0;
		for (const roads of this.byTile.values()) {
			n += roads.length;
		}
		return n;
	}

	/** Summed length (m) of every loaded segment that shares `osmWayId`. */
	public wayLength(osmWayId: number): number {
		let total = 0;
		for (const roads of this.byTile.values()) {
			for (const road of roads) {
				if (road.osmWayId === osmWayId) {
					total += polylineLength(road.centerline);
				}
			}
		}
		return total;
	}

	/**
	 * CPU click-pick: the editable road centerline closest to world point (x, z) [frame E], or null if
	 * none is within `maxLateral` meters. Ties broken by the smaller lateral distance.
	 */
	public pick(x: number, z: number, maxLateral: number): RoadPick | null {
		let best: RoadPick | null = null;

		for (const roads of this.byTile.values()) {
			for (const road of roads) {
				if (road.centerline.length < 2) {
					continue;
				}
				const proj = projectPointToPolyline(road.centerline, x, z);
				if (proj.lateral > maxLateral) {
					continue;
				}
				if (best === null || proj.lateral < best.lateral) {
					best = {
						osmWayId: road.osmWayId,
						s: proj.s,
						lateral: proj.lateral,
						point: pointAtArcLength(road.centerline, proj.s),
						segmentLength: proj.totalLength,
						wayLength: 0, // filled below once we know the winner
					};
				}
			}
		}

		if (best) {
			best.wayLength = this.wayLength(best.osmWayId);
		}
		return best;
	}

	/** Select a way (e.g. from a pick), or clear with null. Returns the selection for convenience. */
	public select(osmWayId: number | null): number | null {
		if (this.selectedWayId !== osmWayId) {
			this.selectedWayId = osmWayId;
			this.revision++;
		}
		return this.selectedWayId;
	}

	/** All loaded centerline segments for the selected way (for the highlight renderer). */
	public selectedCenterlines(): EditableRoadCenterline[] {
		if (this.selectedWayId === null) {
			return [];
		}
		return this.allRoads().filter(r => r.osmWayId === this.selectedWayId);
	}

	/** Tile keys (`"x,y"`) that currently hold a segment of `osmWayId` — the tiles to re-decode when
	 *  its height edit toggles, so the worker drops/re-adds its flat draped roadway (ghost suppression). */
	public tilesContainingWay(osmWayId: number): string[] {
		const out: string[] = [];
		for (const [key, roads] of this.byTile) {
			if (roads.some(r => r.osmWayId === osmWayId)) {
				out.push(key);
			}
		}
		return out;
	}
}

/** Total length (m) of a polyline. */
export function polylineLength(centerline: readonly [number, number][]): number {
	let acc = 0;
	for (let i = 0; i < centerline.length - 1; i++) {
		const [ax, az] = centerline[i];
		const [bx, bz] = centerline[i + 1];
		acc += Math.hypot(bx - ax, bz - az);
	}
	return acc;
}

/** The point at arc-length `s` along a polyline (clamped to the ends). Frame E [x, z]. */
export function pointAtArcLength(centerline: readonly [number, number][], s: number): [number, number] {
	if (centerline.length === 0) {
		return [0, 0];
	}
	if (s <= 0 || centerline.length === 1) {
		return [centerline[0][0], centerline[0][1]];
	}
	let acc = 0;
	for (let i = 0; i < centerline.length - 1; i++) {
		const [ax, az] = centerline[i];
		const [bx, bz] = centerline[i + 1];
		const segLen = Math.hypot(bx - ax, bz - az);
		if (acc + segLen >= s) {
			const t = segLen > 0 ? (s - acc) / segLen : 0;
			return [ax + t * (bx - ax), az + t * (bz - az)];
		}
		acc += segLen;
	}
	const last = centerline[centerline.length - 1];
	return [last[0], last[1]];
}

/**
 * Stitch a way's per-tile centerline segments into ORDERED CONNECTED PIECES. A single OSM way that
 * crosses a tile boundary arrives as several `EditableRoadCenterline` entries (one per tile); the
 * height-edit profile (flat in the middle, grade-limited ramps down to terrain at the piece's TWO ends)
 * needs each connected run as one line so the ramps land at its real ends, not at each tile seam.
 *
 * Returns an ARRAY of pieces. A clean way that's continuous across tiles yields a single piece; genuinely
 * disjoint leftovers (a gap the tiles didn't cover) come back as SEPARATE pieces rather than being
 * concatenated — concatenating them would draw a spurious straight span across the gap and fold the
 * lifted ribbon. Each piece is rendered/ramped independently.
 *
 * Greedy endpoint chaining per piece: seed a chain from one segment, repeatedly attach the segment whose
 * endpoint is within `tol` meters of the chain's head or tail (reversing as needed), dropping the shared
 * boundary node. Boundary nodes from adjacent tiles map to the same world-mercator point (the D→E
 * transform is continuous), so they coincide to floating precision. When nothing more connects, the piece
 * is emitted and a new piece is seeded from the remaining segments. Pure; unit-tested.
 */
export function stitchCenterlines(
	segments: readonly (readonly [number, number][])[],
	tol = 1
): [number, number][][] {
	const remaining = segments.filter(s => s.length >= 1).map(s => s.map(p => [p[0], p[1]] as [number, number]));
	const tol2 = tol * tol;
	const near = (a: [number, number], b: [number, number]): boolean => {
		const dx = a[0] - b[0];
		const dz = a[1] - b[1];
		return dx * dx + dz * dz <= tol2;
	};

	const pieces: [number, number][][] = [];

	while (remaining.length > 0) {
		let chain = remaining.shift() as [number, number][];

		let progress = true;
		while (remaining.length > 0 && progress) {
			progress = false;
			const head = chain[0];
			const tail = chain[chain.length - 1];

			for (let i = 0; i < remaining.length; i++) {
				const seg = remaining[i];
				const a = seg[0];
				const b = seg[seg.length - 1];

				if (near(tail, a)) {
					chain = chain.concat(seg.slice(1));
				} else if (near(tail, b)) {
					chain = chain.concat(seg.slice(0, -1).reverse());
				} else if (near(head, b)) {
					chain = seg.slice(0, -1).concat(chain);
				} else if (near(head, a)) {
					chain = seg.slice(1).reverse().concat(chain);
				} else {
					continue;
				}

				remaining.splice(i, 1);
				progress = true;
				break;
			}
		}

		pieces.push(chain);
	}

	return pieces;
}

/** The shared main-thread instance (mirrors `bridgeRegistry`): tiles feed it, the editor reads it. */
export const editableRoadRegistry = new EditableRoadRegistry();
