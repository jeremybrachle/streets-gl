import RenderableObject3D from "./RenderableObject3D";
import AbstractMesh from "~/lib/renderer/abstract-renderer/AbstractMesh";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import Vec3 from "~/lib/math/Vec3";
import {createBridgeModelFromGLB} from "~/app/objects/models/BridgeModel";

// Strata Lane B Increment 9 — the GGB hero model as a RenderableObject3D (mirrors Car/DeckRibbon). A
// single static vertex-coloured mesh built lazily from the loaded GLB; placed/scaled/yawed by
// GBufferPass.renderBridgeModel from the corridor's model* tunables. Best-effort: if the GLB isn't
// loaded or the build throws, mesh stays null and nothing draws — drive is never blocked.
export default class BridgeModelObject extends RenderableObject3D {
	public mesh: AbstractMesh = null;
	public tried = false;
	/** Span-axis length (local +X) of the normalized mesh in model units, for the default-scale guess. */
	public spanUnits = 0;

	public constructor() {
		super();
		// Drawn directly (no frustum cull in renderBridgeModel) — generous bounds.
		this.setBoundingBox(new Vec3(-1e6, -1e6, -1e6), new Vec3(1e6, 1e6, 1e6));
	}

	public isMeshReady(): boolean {
		return this.mesh !== null;
	}

	public updateMesh(renderer: AbstractRenderer): void {
		if (this.tried) {
			return;
		}
		this.tried = true;

		try {
			const model = createBridgeModelFromGLB();
			this.spanUnits = model.spanUnits;
			const b = model.buffers;
			this.mesh = renderer.createMesh({
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
						name: 'color', size: 3,
						type: RendererTypes.AttributeType.UnsignedByte, format: RendererTypes.AttributeFormat.Float,
						normalized: true, buffer: renderer.createAttributeBuffer({data: b.color})
					})
				]
			});
		} catch (e) {
			console.warn('[Strata] createBridgeModelFromGLB failed, no hero bridge model:', e);
		}
	}
}
