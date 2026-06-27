import Shaders from "../shaders/Shaders";
import MaterialContainer from "./MaterialContainer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";

// Strata Lane B (s13) — BUILDINGS, increment B2: textured GBuffer material for a baked downtown
// building part. Mirrors TreeModelMaterialContainer (deck.vert precision pivot + treeModel.frag
// sampling tDiffuse) but: (1) the facade image is passed in DIRECTLY (pulled from the loaded GLB at
// runtime, not a registered resource), and (2) facades are solid, so we cull back faces. The
// treeModel.frag alpha-discard is harmless on opaque facades (alpha = 1). One material per facade
// texture; a building draws one part per texture.
export default class BuildingModelMaterialContainer extends MaterialContainer {
	public constructor(renderer: AbstractRenderer, image: any) {
		super(renderer);

		this.material = this.renderer.createMaterial({
			name: 'Building model material',
			uniforms: [
				{name: 'projectionMatrix', block: 'MainBlock', type: RendererTypes.UniformType.Matrix4, value: new Float32Array(16)},
				{name: 'modelMatrix', block: 'MainBlock', type: RendererTypes.UniformType.Matrix4, value: new Float32Array(16)},
				{name: 'viewMatrix', block: 'MainBlock', type: RendererTypes.UniformType.Matrix4, value: new Float32Array(16)},
				{name: 'modelViewMatrixPrev', block: 'MainBlock', type: RendererTypes.UniformType.Matrix4, value: new Float32Array(16)},
				{name: 'carMatrix', block: 'MainBlock', type: RendererTypes.UniformType.Matrix4, value: new Float32Array(16)},
				{name: 'carMatrixPrev', block: 'MainBlock', type: RendererTypes.UniformType.Matrix4, value: new Float32Array(16)},
				{
					name: 'tDiffuse',
					block: null,
					type: RendererTypes.UniformType.Texture2D,
					value: this.renderer.createTexture2D({
						anisotropy: 16,
						data: image,
						minFilter: RendererTypes.MinFilter.LinearMipmapLinear,
						magFilter: RendererTypes.MagFilter.Linear,
						wrap: RendererTypes.TextureWrap.Repeat,
						format: RendererTypes.TextureFormat.RGBA8Unorm,
						mipmaps: true,
						flipY: false // glTF UV convention; flip if facades look upside-down
					})
				}
			],
			primitive: {
				frontFace: RendererTypes.FrontFace.CCW,
				cullMode: RendererTypes.CullMode.Back // solid building; flip to None if walls vanish (winding)
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
			vertexShaderSource: Shaders.deck.vertex,
			fragmentShaderSource: Shaders.treeModel.fragment
		});
	}
}
