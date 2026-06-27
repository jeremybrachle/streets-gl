import RenderableObject3D from "./RenderableObject3D";
import AbstractMesh from "~/lib/renderer/abstract-renderer/AbstractMesh";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import Vec3 from "~/lib/math/Vec3";
import Tile from "~/app/objects/Tile";
import {
	extractBuildingsFromGLB, buildBuildingClusters, BuildedBuilding, BuildingInstance, ClusterBuffers
} from "~/app/objects/models/buildingModel";
import {ombbFromCorners, computeBuildingPlacement, OMBBRect} from "~/app/objects/models/buildingPlacement";
import {pickBuildingIndex, SourceFootprint} from "~/app/objects/models/buildingMatcher";
import {mergeFootprints, FootprintItem} from "~/app/objects/models/buildingMerge";
import {placedBuildingsState} from "~/app/objects/models/placedBuildingsState";
import {Vector, CalcConvexHull, ComputeOMBB} from "~/lib/math/OMBB.js";

// Strata Lane B (s13) — BUILDINGS, increment B3: replace the engine's boxy extrusions near the camera
// with kit buildings of the right SHAPE. For each tile in range we read its per-building footprints
// (s8 collision: convex hull + height + base elevation), fit an oriented bounding box (OMBB), pick a
// matching kit building (buildingMatcher), stretch+orient it onto the footprint (buildingPlacement),
// bake them into one merged mesh per facade texture (buildBuildingClusters), and HIDE the original
// extrusion (tile.hideBuilding) so it's a true replacement. Per-tile clusters tear down when the tile
// leaves range / unloads, restoring the hidden extrusions. Mirrors WorldTreeScatter; near-ring keeps
// the count + GPU memory bounded. Gated by placedBuildingsState.enabled (KeyU). Drawn by
// GBufferPass.renderModelBuildingScatter.

const RenderDistance = 650;       // build model buildings for tiles within this many meters of the camera
const MaxBuildsPerFrame = 1;      // a tile can hold a lot of buildings — bake at most one tile/frame
// Footprint size gate (meters, long side). Tiny structures aren't worth a model + balloon the count;
// huge footprints (the Ferry Building etc.) are usually MULTI-POLYGON real buildings — one kit model
// per piece looks like clashing styles, and stretching one model 100 m+ reads as patchwork. Both keep
// their original extrusion. Tunable — the perf + "multiple skins" knobs.
const MinFootprintLong = 8;
const MaxFootprintLong = 300;     // safety cap only (skip absurd merges); the Ferry-size buildings pass

// Iconic landmarks to LEAVE as the engine's own geometry (we'll add accurate hero models later). Any
// merged group containing one of these OSM way ids is skipped entirely — neither replaced nor hidden —
// so e.g. the Ferry Building keeps its clock-tower steeple. Add ids by clicking a building in-app (the
// selection panel shows "Way №…"). Matched against the UNPACKED osm id, so type doesn't matter.
const LANDMARK_WAY_IDS = new Set<number>([
	// Engine-rendered ids (from clicking the building in-app — these differ from Overpass ids).
	451331530, // Coit Tower
	406710835, // Ferry Building tower
	7325085,   // Oracle Park (relation)
	// Overpass ids (kept; harmless if the engine renders different ids).
	24460886, 404449724, 28824850
]);

// Generic steeple/tower rule: a SMALL footprint that's TALL is an ornamental tower (Coit, church
// steeples) — the kit has no steeples, so stretching a box up looks wrong. Leave these as engine
// geometry. Small footprint in BOTH plan dims + tall distinguishes them from slender skyscrapers
// (which have a larger plan). Tunable.
const TowerMaxLong = 18;
const TowerMinHeight = 22;

export interface BuildingClusterPart {
	textureKey: string;
	mesh: AbstractMesh;
}

interface TileBuildingCluster {
	anchor: [number, number]; // tile world position (precision pivot)
	parts: BuildingClusterPart[];
	hiddenIds: number[];      // packed building ids we hid on this tile (restored on teardown)
	tile: Tile;               // for restoring the extrusions
}

export default class ModelBuildingScatter extends RenderableObject3D {
	public mesh: AbstractMesh = null; // unused; we draw per-tile, per-texture meshes
	public clusters: Map<number, TileBuildingCluster> = new Map();
	public images: Map<string, any> = new Map();

	private buildings: BuildedBuilding[] | null = null;
	private sourceFootprints: SourceFootprint[] = [];
	private loggedProbe = false;

	public constructor() {
		super();
		this.setBoundingBox(new Vec3(-1e6, -1e6, -1e6), new Vec3(1e6, 1e6, 1e6));
	}

	public isMeshReady(): boolean {
		return true; // built/torn down in sync(), not via the scene's updateMesh traversal
	}

	public updateMesh(): void {}

	/** Reconcile the resident per-tile clusters with the tiles near the camera (gated by KeyU). */
	public sync(renderer: AbstractRenderer, tiles: Tile[]): void {
		if (!placedBuildingsState.enabled) {
			if (this.clusters.size > 0) this.clear();
			return;
		}
		if (!this.ensureBuildings()) {
			return;
		}

		const liveIds = new Set<number>();
		let builds = 0;

		for (const tile of tiles) {
			liveIds.add(tile.localId);
			const loaded = tile.extrudedMesh != null;
			const inRange = tile.distanceToCamera !== null && tile.distanceToCamera < RenderDistance;
			const has = this.clusters.has(tile.localId);

			if (inRange && loaded && !has && builds < MaxBuildsPerFrame) {
				this.buildTileCluster(renderer, tile);
				builds++;
			} else if (!inRange && has) {
				this.deleteCluster(tile.localId);
			}
		}

		for (const id of this.clusters.keys()) {
			if (!liveIds.has(id)) this.deleteCluster(id);
		}
	}

	private ensureBuildings(): boolean {
		if (this.buildings) return true;
		try {
			const {buildings, images} = extractBuildingsFromGLB('downtownBuildings');
			this.buildings = buildings;
			this.images = images;
			this.sourceFootprints = buildings.map(b => ({width: b.dims.width, depth: b.dims.depth}));
		} catch (e) {
			this.buildings = null; // GLB not loaded yet — retry next frame
			return false;
		}
		return this.buildings.length > 0;
	}

	private buildTileCluster(renderer: AbstractRenderer, tile: Tile): void {
		const buildings = this.buildings;
		if (!buildings) return;

		const anchor: [number, number] = [tile.position.x, tile.position.z];
		const instances: BuildingInstance[] = [];
		const hiddenIds: number[] = [];

		// Merge the overlapping footprints of each real building (outline + building:parts) so a
		// landmark like the Ferry Building gets ONE model, not a clashing kit piece per polygon.
		const items: FootprintItem[] = [];
		for (const [packedId, fp] of tile.buildingFootprints) {
			items.push({id: packedId, polygon: fp.polygon, aabb: fp.aabb, height: fp.height, baseY: fp.baseY});
		}

		for (const group of mergeFootprints(items)) {
			// Leave iconic landmarks as the engine's geometry (hero models come later).
			const osmIds = group.ids.map(packed => Tile.unpackFeatureId(packed)[0]);
			if (osmIds.some(id => LANDMARK_WAY_IDS.has(id))) continue;

			const rect = this.footprintToWorldOMBB(group.polygon, tile.position.x, tile.position.z);
			if (!rect) {
				continue;
			}
			if (rect.longLen < MinFootprintLong || rect.longLen > MaxFootprintLong) {
				console.log(`[Strata] building skipped (size ${rect.longLen.toFixed(0)}m): ways ${osmIds.join(',')}`);
				continue;
			}
			// Ornamental tower / steeple — leave it as engine geometry.
			if (rect.longLen < TowerMaxLong && group.height > TowerMinHeight) {
				continue;
			}

			const seed = rect.centerX * 0.0123 + rect.centerZ * 0.0457;
			const index = pickBuildingIndex(rect.longLen, rect.shortLen, this.sourceFootprints, seed);
			const placement = computeBuildingPlacement(rect, group.height, buildings[index].dims, group.baseY);
			instances.push({buildingIndex: index, placement});

			// Hide every member extrusion of the merged building.
			for (const id of group.ids) {
				tile.hideBuilding(id);
				hiddenIds.push(id);
			}
		}

		const clusterBuffers = buildBuildingClusters(buildings, instances, anchor);
		const parts: BuildingClusterPart[] = [];
		for (const [textureKey, buffers] of clusterBuffers) {
			if (buffers.indices.length === 0) continue;
			parts.push({textureKey, mesh: this.buildMesh(renderer, buffers)});
		}

		if (!this.loggedProbe) {
			this.loggedProbe = true;
			console.log(`[Strata] model buildings: tile ${tile.localId} → ${instances.length} buildings, ` +
				`${parts.length} texture draws (${hiddenIds.length} extrusions hidden)`);
		}

		this.clusters.set(tile.localId, {anchor, parts, hiddenIds, tile});
	}

	// Footprint (tile-local convex hull) → world-space oriented bounding box rectangle. Uses the engine's
	// rotating-calipers OMBB so the model aligns to SF's rotated street grid (an AABB would balloon).
	private footprintToWorldOMBB(polygon: {x: number; z: number}[], ox: number, oz: number): OMBBRect | null {
		if (polygon.length < 3) return null;
		try {
			const pts = polygon.map(p => new (Vector as any)(p.x + ox, p.z + oz));
			const hull = CalcConvexHull(pts);
			if (!hull || hull.length < 3) return null;
			const obb = ComputeOMBB(hull); // [upperLeft, bottomLeft, bottomRight, upperRight] of {x,y}
			if (!obb || obb.length !== 4) return null;
			return ombbFromCorners(obb.map((v: any) => ({x: v.x, z: v.y})));
		} catch (e) {
			return null;
		}
	}

	private buildMesh(renderer: AbstractRenderer, b: ClusterBuffers): AbstractMesh {
		return renderer.createMesh({
			indexed: true,
			indices: b.indices,
			attributes: [
				renderer.createAttribute({
					name: 'position', size: 3,
					type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float,
					normalized: false, buffer: renderer.createAttributeBuffer({data: b.position})
				}),
				renderer.createAttribute({
					name: 'normal', size: 3,
					type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float,
					normalized: false, buffer: renderer.createAttributeBuffer({data: b.normal})
				}),
				renderer.createAttribute({
					name: 'uv', size: 2,
					type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float,
					normalized: false, buffer: renderer.createAttributeBuffer({data: b.uv})
				})
			]
		});
	}

	private deleteCluster(id: number): void {
		const cluster = this.clusters.get(id);
		if (!cluster) return;
		// Restore the hidden extrusions if the tile is still loaded (it's null once unloaded).
		if (cluster.tile.extrudedMesh != null) {
			for (const packedId of cluster.hiddenIds) {
				try {
					cluster.tile.showBuilding(packedId);
				} catch (e) { /* offset map gone with the tile — nothing to restore */ }
			}
		}
		for (const part of cluster.parts) part.mesh.delete();
		this.clusters.delete(id);
	}

	private clear(): void {
		for (const id of this.clusters.keys()) this.deleteCluster(id);
	}
}
