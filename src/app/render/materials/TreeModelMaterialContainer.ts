import Shaders from "../shaders/Shaders";
import MaterialContainer from "./MaterialContainer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";
import ResourceLoader from "~/app/world/ResourceLoader";

// Strata Lane B (s9 models) — textured, alpha-cutout GBuffer material for a baked Quaternius tree
// cluster. Reuses deck.vert (position/normal/uv + the carMatrix precision pivot) with treeModel.frag
// (samples tDiffuse, discards alpha < 0.5 for the leaf cutout). One instance per texture: bark =
// opaque trunk, leaf = alpha canopy. The diffuse resource name is passed in. Same MainBlock layout
// as DeckMaterialContainer.
export default class TreeModelMaterialContainer extends MaterialContainer {
	public constructor(renderer: AbstractRenderer, diffuseResource: string) {
		super(renderer);

		this.material = this.renderer.createMaterial({
			name: `Tree model material (${diffuseResource})`,
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
						data: ResourceLoader.get(diffuseResource),
						minFilter: RendererTypes.MinFilter.LinearMipmapLinear,
						magFilter: RendererTypes.MagFilter.Linear,
						wrap: RendererTypes.TextureWrap.Repeat,
						format: RendererTypes.TextureFormat.RGBA8Unorm,
						mipmaps: true,
						flipY: false // glTF UV convention (top-left origin); flip to true if textures look upside-down
					})
				}
			],
			primitive: {
				frontFace: RendererTypes.FrontFace.CCW,
				cullMode: RendererTypes.CullMode.None // leaf cards are 2-sided
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
