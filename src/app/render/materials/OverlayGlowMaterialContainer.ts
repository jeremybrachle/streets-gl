import Shaders from "../shaders/Shaders";
import MaterialContainer from "./MaterialContainer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";

// Strata GPS/overlay — a GBuffer material for the road-graph + route ribbons that renders them UNLIT and
// GLOWING (see overlayLineGlow.frag). Identical to CarMaterialContainer (same MainBlock matrix uniforms +
// per-vertex colour + full origin-relative transform), so the existing overlay draw code sets the same
// uniforms; only the fragment shader differs (car.vert is reused). Kept SEPARATE from the car material so
// the car/deck/bridge stay normally lit — no shared glow-state to leak between draws.
export default class OverlayGlowMaterialContainer extends MaterialContainer {
	public constructor(renderer: AbstractRenderer) {
		super(renderer);

		this.material = this.renderer.createMaterial({
			name: 'Overlay glow material',
			uniforms: [
				{
					name: 'projectionMatrix',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Matrix4,
					value: new Float32Array(16)
				}, {
					name: 'modelMatrix',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Matrix4,
					value: new Float32Array(16)
				}, {
					name: 'viewMatrix',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Matrix4,
					value: new Float32Array(16)
				}, {
					name: 'modelViewMatrixPrev',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Matrix4,
					value: new Float32Array(16)
				}, {
					name: 'carMatrix',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Matrix4,
					value: new Float32Array(16)
				}, {
					name: 'carMatrixPrev',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Matrix4,
					value: new Float32Array(16)
				}
			],
			primitive: {
				frontFace: RendererTypes.FrontFace.CCW,
				cullMode: RendererTypes.CullMode.None
			},
			depth: {
				depthWrite: true,
				depthCompare: RendererTypes.DepthCompare.LessEqual
			},
			blend: {
				color: {
					operation: RendererTypes.BlendOperation.Add,
					srcFactor: RendererTypes.BlendFactor.One,
					dstFactor: RendererTypes.BlendFactor.Zero
				},
				alpha: {
					operation: RendererTypes.BlendOperation.Add,
					srcFactor: RendererTypes.BlendFactor.One,
					dstFactor: RendererTypes.BlendFactor.Zero
				}
			},
			vertexShaderSource: Shaders.car.vertex,
			fragmentShaderSource: Shaders.overlayLineGlow.fragment
		});
	}
}
