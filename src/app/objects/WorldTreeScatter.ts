import RenderableObject3D from "./RenderableObject3D";
import AbstractMesh from "~/lib/renderer/abstract-renderer/AbstractMesh";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import Vec3 from "~/lib/math/Vec3";
import Tile from "~/app/objects/Tile";
import {
	buildSpeciesClusters, extractTreeVariantsFromGLB, placementsFromTreeInstanceBuffer,
	ClusterBuffers, TreeVariant
} from "~/app/objects/models/TreeClusterModel";
import {RenderSpecies, SpeciesDef, TREE_SPECIES} from "~/app/objects/models/treeSpecies";
import {worldTreeScatterState} from "~/app/objects/models/worldTreeScatterState";

// Strata Lane B (s11) — wire the new textured-GLB trees into the engine's REAL OSM forest scatter.
// Each streamed tile already carries a 'tree' instance buffer (the Poisson-scattered forest/shrubbery
// points, road-culled in increment 5). For every tile within render range we decode that buffer into
// our model-tree placements (reusing the Presidio pipeline) and build per-species bark/leaf meshes,
// keyed by tile.localId. Clusters tear down when the tile leaves range or is unloaded, so GPU memory
// stays bounded and only the trees near the camera are ever resident. Drawn by
// GBufferPass.renderWorldTreeScatter; gated by worldTreeScatterState.enabled (KeyT).

// Build model trees for tiles whose center is within this many world meters of the camera. The engine
// billboard LOD0 reaches 2000m; models are heavier, so a tighter ring keeps the count sane (and the
// billboards still fill the distance — we MIX for now). Tunable.
const RenderDistance = 1100;
// Cap new cluster builds per frame so a burst of tiles entering range doesn't spike a frame.
const MaxBuildsPerFrame = 2;
// Each model tree is scaled so it stands ~this tall (model units differ per pack); matches the probe.
const TargetTreeHeight = 9;

interface TileTreeCluster {
	anchor: [number, number]; // tile world position (x, z) — the precision pivot for its meshes
	species: RenderSpecies[]; // index-aligned to TREE_SPECIES
}

export default class WorldTreeScatter extends RenderableObject3D {
	public mesh: AbstractMesh = null; // unused (we draw per-tile, per-species meshes); base contract
	public clusters: Map<number, TileTreeCluster> = new Map();

	private variants: TreeVariant[][] | null = null;
	private variantHeights: number[][] | null = null;
	private loggedProbe = false;

	public constructor() {
		super();
		this.setBoundingBox(new Vec3(-1e6, -1e6, -1e6), new Vec3(1e6, 1e6, 1e6));
	}

	public isMeshReady(): boolean {
		return this.clusters.size > 0;
	}

	public updateMesh(): void {}

	/** Reconcile the resident per-tile clusters with the tiles currently near the camera. Builds new
	 * clusters for tiles that just came into range, tears down those that left or were unloaded. */
	public sync(renderer: AbstractRenderer, tiles: Tile[]): void {
		if (!worldTreeScatterState.enabled) {
			if (this.clusters.size > 0) this.clear();
			return;
		}

		if (!this.ensureVariants()) {
			return;
		}

		const liveIds = new Set<number>();
		let builds = 0;

		for (const tile of tiles) {
			liveIds.add(tile.localId);

			// `extrudedMesh` is set in tile.load(), so it marks the tile (and its instance buffers) as
			// ready — don't record a cluster for a tile still streaming in, or it'd be stuck empty.
			const loaded = tile.extrudedMesh != null;
			const inRange = tile.distanceToCamera !== null && tile.distanceToCamera < RenderDistance;
			const has = this.clusters.has(tile.localId);

			if (inRange && loaded && !has && builds < MaxBuildsPerFrame) {
				if (this.buildTileCluster(renderer, tile)) builds++;
			} else if (!inRange && has) {
				this.deleteCluster(tile.localId);
			}
		}

		// Tear down clusters whose tile is no longer loaded.
		for (const id of this.clusters.keys()) {
			if (!liveIds.has(id)) this.deleteCluster(id);
		}
	}

	private ensureVariants(): boolean {
		if (this.variants) return true;

		try {
			this.variants = TREE_SPECIES.map((s: SpeciesDef) =>
				extractTreeVariantsFromGLB(s.glb, {excludeNames: s.exclude, singleVariant: s.singleTree}));
		} catch (e) {
			// GLBs not loaded yet — retry next frame.
			this.variants = null;
			return false;
		}

		this.variantHeights = this.variants.map(vs => vs.map(v => v.height));
		return this.variants.some(vs => vs.length > 0);
	}

	// Returns true if a cluster (possibly empty of geometry) was created for the tile.
	private buildTileCluster(renderer: AbstractRenderer, tile: Tile): boolean {
		const treeBuf = tile.instanceBuffers.get('tree');
		if (!treeBuf || treeBuf.rawLOD0.length === 0) {
			// No forest in this tile — record an empty cluster so we don't re-test it every frame.
			this.clusters.set(tile.localId, {anchor: [tile.position.x, tile.position.z], species: []});
			return true;
		}

		const anchor: [number, number] = [tile.position.x, tile.position.z];
		const placements = placementsFromTreeInstanceBuffer({
			raw: treeBuf.rawLOD0,
			originX: tile.position.x,
			originZ: tile.position.z,
			variantHeights: this.variantHeights,
			targetHeight: TargetTreeHeight
		});

		if (!this.loggedProbe) {
			this.loggedProbe = true;
			const n = placements[0];
			console.log(`[Strata] world tree scatter: tile ${tile.localId} → ${placements.length} model trees ` +
				`(buffer ${treeBuf.rawLOD0.length / 6} instances)` + (n ? `, first @ (${n.x.toFixed(1)}, ${n.y.toFixed(1)}, ${n.z.toFixed(1)}) species ${n.species}` : ''));
		}

		const clusterBuffers = buildSpeciesClusters(this.variants, placements, anchor);
		const species: RenderSpecies[] = TREE_SPECIES.map((s, i) => ({
			bark: s.bark,
			leaf: s.leaf,
			barkMesh: clusterBuffers[i].bark.indices.length ? this.buildMesh(renderer, clusterBuffers[i].bark) : null,
			leafMesh: clusterBuffers[i].leaf.indices.length ? this.buildMesh(renderer, clusterBuffers[i].leaf) : null
		}));

		this.clusters.set(tile.localId, {anchor, species});
		return true;
	}

	private deleteCluster(id: number): void {
		const cluster = this.clusters.get(id);
		if (!cluster) return;
		for (const s of cluster.species) {
			if (s.barkMesh) s.barkMesh.delete();
			if (s.leafMesh) s.leafMesh.delete();
		}
		this.clusters.delete(id);
	}

	private clear(): void {
		for (const id of this.clusters.keys()) this.deleteCluster(id);
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
}
