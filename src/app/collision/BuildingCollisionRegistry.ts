import {AABB2D, Polygon2D, circleIntersectsAABB, resolveCircleVsPolygons} from "./FootprintCollision";
import {hiddenBuildingsRegistry} from "~/app/world/HiddenBuildingsRegistry";

// Strata physics spike — the world-space building-footprint store the drive physics queries each
// frame for wall collision. Mirrors bridgeRegistry: a plain singleton (no React/atom plumbing) so
// the navigator reads it on the hot path. Tiles register their CONVEX-HULL footprints as they stream
// in (TileObjectsSystem) and unregister on removal. OFF by default — the open-world feel is untouched
// until the user toggles it (KeyB) so you can still free-roam through buildings when collision is off.
//
// Footprints are convex hulls, not world-axis AABBs: a building rotated off the mercator axes (SF's
// grid) gets an AABB that balloons into the streets, blocking gaps you should be able to drive
// through; the hull follows the real outline. The AABB is kept per entry only for cheap broad-phase.

export interface FootprintEntry {
	packedId: number;     // so a building the user "deleted from view" (hidden) stops colliding too
	aabb: AABB2D;         // broad-phase rectangle (world space)
	polygon: Polygon2D;   // tight convex outline (world space) used for the actual push-out
}

// Footprints derived from a placed MODEL (e.g. the GGB hero bridge towers), in world space. These are
// HEIGHT-GATED: they only block the car when it's at/above `yMin` (deck/road level), so on the road
// you can't cut through a tower leg, but when you fall off and drive UNDER the bridge you pass freely.
export interface ModelFootprint {
	aabb: AABB2D;
	polygon: Polygon2D;
	yMin: number; // world Y below which this footprint does not collide (the road level minus a margin)
}

export class BuildingCollisionRegistry {
	/** Master switch (toggle key in the drive navigator). Default OFF = today's behaviour. */
	public enabled = false;

	/** Show the translucent debug overlay of the collision footprints (dev-panel toggle). */
	public showDebug = false;

	/** Car collision circle radius (m). Tunable in the dev panel — how close you can hug a wall. */
	public radius = 1.6;

	/** Bumped whenever the footprint set changes (tile add/remove), so the debug overlay rebuilds. */
	public revision = 0;

	// Footprints keyed by the tile that owns them, so removeTile drops exactly that tile's set.
	private byTile = new Map<number, FootprintEntry[]>();

	// Height-gated footprints from placed models (e.g. the bridge towers). Re-set whenever the model
	// placement changes (renderBridgeModel), so they track the live transform sliders.
	private modelFootprints: ModelFootprint[] = [];

	public setTile(tileId: number, entries: FootprintEntry[]): void {
		if (entries.length === 0) {
			this.byTile.delete(tileId);
		} else {
			this.byTile.set(tileId, entries);
		}
		this.revision++;
	}

	public removeTile(tileId: number): void {
		if (this.byTile.delete(tileId)) {
			this.revision++;
		}
	}

	public clear(): void {
		this.byTile.clear();
		this.revision++;
	}

	/** Replace the placed-model (tower) footprints. Cheap; called when the bridge placement changes. */
	public setModelFootprints(footprints: ModelFootprint[]): void {
		this.modelFootprints = footprints;
		this.revision++;
	}

	/**
	 * Slide the car circle (center x,z) out of every nearby, visible building footprint. Broad-phase:
	 * only polygons whose AABB the circle overlaps reach the resolver. Hidden buildings are skipped so
	 * deleting a building from view also removes its collision.
	 */
	public resolve(x: number, z: number, carY: number): {x: number; z: number} {
		const hits: Polygon2D[] = [];

		for (const entries of this.byTile.values()) {
			for (const entry of entries) {
				if (circleIntersectsAABB(x, z, this.radius, entry.aabb) && !hiddenBuildingsRegistry.isHidden(entry.packedId)) {
					hits.push(entry.polygon);
				}
			}
		}

		// Model towers: only collide when the car is at/above road level (so you drive under freely).
		for (const m of this.modelFootprints) {
			if (carY >= m.yMin && circleIntersectsAABB(x, z, this.radius, m.aabb)) {
				hits.push(m.polygon);
			}
		}

		if (hits.length === 0) {
			return {x, z};
		}

		return resolveCircleVsPolygons(x, z, this.radius, hits);
	}

	/**
	 * Visible footprint polygons whose broad-phase AABB lies within `radius` of (cx,cz) — feeds the
	 * debug overlay, bounded to near the car so the mesh stays small (the whole-world set tanks the
	 * frame rate). Cheap AABB-vs-expanded-box reject using the stored broad-phase rectangle.
	 */
	public visiblePolygonsNear(cx: number, cz: number, radius: number): Polygon2D[] {
		const out: Polygon2D[] = [];
		const near = (a: AABB2D): boolean =>
			!(a.maxX < cx - radius || a.minX > cx + radius || a.maxZ < cz - radius || a.minZ > cz + radius);
		for (const entries of this.byTile.values()) {
			for (const entry of entries) {
				if (near(entry.aabb) && !hiddenBuildingsRegistry.isHidden(entry.packedId)) {
					out.push(entry.polygon);
				}
			}
		}
		for (const m of this.modelFootprints) {
			if (near(m.aabb)) {
				out.push(m.polygon);
			}
		}
		return out;
	}
}

export const buildingCollisionRegistry = new BuildingCollisionRegistry();
