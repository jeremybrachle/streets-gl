import RenderableObject3D from "./RenderableObject3D";
import AbstractMesh from "~/lib/renderer/abstract-renderer/AbstractMesh";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import Vec3 from "~/lib/math/Vec3";
import {bridgeRegistry} from "~/app/bridge/BridgeRegistry";
import {buildDeckRibbon, makeDeckHeightFn, DeckMeshBuffers, HeightFn} from "~/app/bridge/DeckMesh";

// Strata Lane B Increment 3 — the VISIBLE bridge deck. A RenderableObject3D whose mesh is the deck
// ribbon generated from the live bridgeRegistry (the same corridor the car drives) AND the real
// terrain: the ramp ends blend down to the DEM exactly like the car's ground query, so the drawn
// road meets the land at the abutments instead of diving to sea level. Drawn + (re)built by
// GBufferPass.renderDeck (which owns the terrain height provider); gated by courseMode there. No
// moat code — renderer glue.
export default class DeckRibbon extends RenderableObject3D {
	public mesh: AbstractMesh = null;

	// Precision pivot: vertices are baked relative to this world (x, z); the renderer finishes the
	// origin shift with a translate matrix. Set when the mesh is (re)built from the corridor.
	public anchor: [number, number] = [0, 0];

	// The registry revision the current mesh was built from; -1 forces a first build.
	public builtRevision = -1;

	// False while any rib sampled the DEM before its tile had loaded — renderDeck keeps rebuilding
	// until the terrain under the ramps is real (then the deck settles onto the ground).
	public complete = false;

	public constructor() {
		super();
		// Generous bounding box — this object is drawn directly (no frustum cull in renderDeck).
		this.setBoundingBox(new Vec3(-1e6, -1e6, -1e6), new Vec3(1e6, 1e6, 1e6));
	}

	public isMeshReady(): boolean {
		return this.mesh !== null;
	}

	// updateMesh is a no-op: the deck needs the terrain height provider, which only GBufferPass has,
	// so renderDeck drives the build via rebuild() below.
	public updateMesh(): void {}

	/** True when the drawn mesh no longer matches the registry / terrain and should be rebuilt. */
	public needsRebuild(): boolean {
		return this.mesh === null || this.builtRevision !== bridgeRegistry.revision || !this.complete;
	}

	/**
	 * (Re)build the ribbon from the first corridor, blending the ramps down to `groundAt` (the DEM,
	 * sampled in world coords). `groundAt` returns null for not-yet-loaded tiles; for those ribs we
	 * keep the deck flat (no dive) and mark the build incomplete so it rebuilds once terrain arrives.
	 */
	public rebuild(renderer: AbstractRenderer, groundAt: (x: number, z: number) => number | null): void {
		const corridor = bridgeRegistry.corridors[0];

		if (!corridor || corridor.centerline.length < 2) {
			this.builtRevision = bridgeRegistry.revision;
			this.complete = true;
			return;
		}

		let complete = true;
		const ground: HeightFn = (x, z) => {
			const h = groundAt(x, z);
			if (h === null) {
				complete = false;
				return corridor.deckHeight; // stay flat/elevated until the tile loads, then rebuild
			}
			return h;
		};

		this.anchor = corridor.centerline[0];
		const buffers = buildDeckRibbon(corridor, makeDeckHeightFn(corridor, ground), this.anchor);

		if (this.mesh) {
			this.mesh.delete();
		}

		this.mesh = this.buildMesh(renderer, buffers);
		this.builtRevision = bridgeRegistry.revision;
		this.complete = complete;
	}

	private buildMesh(renderer: AbstractRenderer, buffers: DeckMeshBuffers): AbstractMesh {
		return renderer.createMesh({
			indexed: true,
			indices: buffers.indices,
			attributes: [
				renderer.createAttribute({
					name: 'position',
					size: 3,
					type: RendererTypes.AttributeType.Float32,
					format: RendererTypes.AttributeFormat.Float,
					normalized: false,
					buffer: renderer.createAttributeBuffer({data: buffers.position})
				}),
				renderer.createAttribute({
					name: 'normal',
					size: 3,
					type: RendererTypes.AttributeType.Float32,
					format: RendererTypes.AttributeFormat.Float,
					normalized: false,
					buffer: renderer.createAttributeBuffer({data: buffers.normal})
				}),
				renderer.createAttribute({
					name: 'color',
					size: 3,
					type: RendererTypes.AttributeType.UnsignedByte,
					format: RendererTypes.AttributeFormat.Float,
					normalized: true,
					buffer: renderer.createAttributeBuffer({data: buffers.color})
				}),
				renderer.createAttribute({
					name: 'uv',
					size: 2,
					type: RendererTypes.AttributeType.Float32,
					format: RendererTypes.AttributeFormat.Float,
					normalized: false,
					buffer: renderer.createAttributeBuffer({data: buffers.uv})
				})
			]
		});
	}
}
