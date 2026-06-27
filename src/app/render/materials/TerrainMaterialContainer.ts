import Shaders from "../shaders/Shaders";
import MaterialContainer from "./MaterialContainer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";
import ResourceLoader from "../../world/ResourceLoader";
import Config from "../../Config";

export default class TerrainMaterialContainer extends MaterialContainer {
	public constructor(renderer: AbstractRenderer) {
		super(renderer);

		this.material = this.renderer.createMaterial({
			name: 'Terrain material',
			uniforms: [
				{
					name: 'modelViewMatrix',
					block: 'PerMesh',
					type: RendererTypes.UniformType.Matrix4,
					value: new Float32Array(16)
				}, {
					name: 'modelViewMatrixPrev',
					block: 'PerMesh',
					type: RendererTypes.UniformType.Matrix4,
					value: new Float32Array(16)
				}, {
					name: 'projectionMatrix',
					block: 'PerMaterial',
					type: RendererTypes.UniformType.Matrix4,
					value: new Float32Array(16)
				}, {
					name: 'biomeCoordinates',
					block: 'PerMaterial',
					type: RendererTypes.UniformType.Float2,
					value: new Float32Array(2)
				}, {
					name: 'time',
					block: 'PerMaterial',
					type: RendererTypes.UniformType.Float1,
					value: new Float32Array(1)
				}, {
					name: 'usageRange',
					block: 'PerMaterial',
					type: RendererTypes.UniformType.Float2,
					value: new Float32Array(2)
				}, {
					// Strata Lane B (s15) — live base-terrain tiling multiplier (dev-panel slider). 1.0 =
					// engine default; higher = finer/less-zoomed so the base ground can match the decals.
					name: 'detailScale',
					block: 'PerMaterial',
					type: RendererTypes.UniformType.Float1,
					value: new Float32Array([1])
				}, {
					name: 'transformNormal0',
					block: 'PerMesh',
					type: RendererTypes.UniformType.Float4,
					value: new Float32Array(3)
				}, {
					name: 'transformNormal1',
					block: 'PerMesh',
					type: RendererTypes.UniformType.Float4,
					value: new Float32Array(4)
				}, {
					name: 'transformMask',
					block: 'PerMesh',
					type: RendererTypes.UniformType.Float3,
					value: new Float32Array(3)
				}, {
					name: 'transformWater0',
					block: 'PerMesh',
					type: RendererTypes.UniformType.Float4,
					value: new Float32Array(4)
				}, {
					name: 'transformWater1',
					block: 'PerMesh',
					type: RendererTypes.UniformType.Float4,
					value: new Float32Array(4)
				}, {
					name: 'size',
					block: 'PerMesh',
					type: RendererTypes.UniformType.Float1,
					value: new Float32Array(1)
				}, {
					name: 'segmentCount',
					block: 'PerMesh',
					type: RendererTypes.UniformType.Float1,
					value: new Float32Array(1)
				}, {
					name: 'detailTextureOffset',
					block: 'PerMesh',
					type: RendererTypes.UniformType.Float2,
					value: new Float32Array(2)
				}, {
					name: 'levelId',
					block: 'PerMesh',
					type: RendererTypes.UniformType.Int1,
					value: new Int32Array(1)
				}, {
					name: 'cameraPosition',
					block: 'PerMesh',
					type: RendererTypes.UniformType.Float2,
					value: new Float32Array(2)
				}, {
					name: 'tRingHeight',
					block: null,
					type: RendererTypes.UniformType.Texture2DArray,
					value: null
				}, {
					name: 'tNormal',
					block: null,
					type: RendererTypes.UniformType.Texture2DArray,
					value: null
				}, {
					name: 'tWater',
					block: null,
					type: RendererTypes.UniformType.Texture2DArray,
					value: null
				}, {
					name: 'tWaterMask',
					block: null,
					type: RendererTypes.UniformType.Texture2D,
					value: null
				}, {
					name: 'tUsage',
					block: null,
					type: RendererTypes.UniformType.Texture2DArray,
					value: null
				}, {
					name: 'tUsageMask',
					block: null,
					type: RendererTypes.UniformType.Texture2D,
					value: null
				}, {
					name: 'tUsageMaps',
					block: null,
					type: RendererTypes.UniformType.Texture2DArray,
					value: this.renderer.createTexture2DArray({
						depth: 2,
						// Strata Lane B (s11) — Poly Haven CC0 "forrest_ground_01" as the worn/used overlay
						// (height-blended near roads/buildings) instead of the arid sandy soil. 512² to match.
						data: [
							ResourceLoader.get('forrestGroundColor'),
							ResourceLoader.get('forrestGroundHeight')
						],
						anisotropy: 16,
						minFilter: RendererTypes.MinFilter.LinearMipmapLinear,
						magFilter: RendererTypes.MagFilter.Linear,
						wrap: RendererTypes.TextureWrap.Repeat,
						format: RendererTypes.TextureFormat.RGBA8Unorm,
						mipmaps: true
					})
				}, {
					name: 'tDetailMaps',
					block: null,
					type: RendererTypes.UniformType.Texture2DArray,
					value: this.renderer.createTexture2DArray({
						depth: 2,
						// Strata Lane B (s11) — Poly Haven CC0 "aerial_grass_rock" as the base ground color
						// (1024² to match the kept generic normal) so terrain reads as grass, not arid soil.
						data: [
							ResourceLoader.get('aerialGrassColor'),
							ResourceLoader.get('genericTerrainNormal'),
						],
						anisotropy: 16,
						minFilter: RendererTypes.MinFilter.LinearMipmapLinear,
						magFilter: RendererTypes.MagFilter.Linear,
						wrap: RendererTypes.TextureWrap.Repeat,
						format: RendererTypes.TextureFormat.RGBA8Unorm,
						mipmaps: true
					})
				}, {
					name: 'tDetailNoise',
					block: null,
					type: RendererTypes.UniformType.Texture2D,
					value: this.renderer.createTexture2D({
						anisotropy: 16,
						data: ResourceLoader.get('noise'),
						minFilter: RendererTypes.MinFilter.LinearMipmapLinear,
						magFilter: RendererTypes.MagFilter.Linear,
						wrap: RendererTypes.TextureWrap.Repeat,
						format: RendererTypes.TextureFormat.RGBA8Unorm,
						mipmaps: true
					})
				}, {
					name: 'tWaterNormal',
					block: null,
					type: RendererTypes.UniformType.Texture2D,
					value: this.renderer.createTexture2D({
						anisotropy: 16,
						data: ResourceLoader.get('waterNormal'),
						minFilter: RendererTypes.MinFilter.LinearMipmapLinear,
						magFilter: RendererTypes.MagFilter.Linear,
						wrap: RendererTypes.TextureWrap.Repeat,
						format: RendererTypes.TextureFormat.RGBA8Unorm,
						mipmaps: true
					})
				}, {
					name: 'tBiomeMap',
					block: null,
					type: RendererTypes.UniformType.Texture2D,
					value: this.renderer.createTexture2D({
						anisotropy: 16,
						// Strata Lane B (s11) — neutral biome map: the shader does `biome.rgb * 1.5`, so a
						// flat 170/255 ≈ 0.667 yields a 1.0 tint (identity), letting the grass show its
						// natural color instead of the arid regional biome tint. Swap back to 'biomeMap'
						// (biomes_blurred) to restore regional biome coloring.
						data: ResourceLoader.get('biomeNeutral'),
						minFilter: RendererTypes.MinFilter.Linear,
						magFilter: RendererTypes.MagFilter.Linear,
						wrap: RendererTypes.TextureWrap.Repeat,
						format: RendererTypes.TextureFormat.RGBA8Unorm,
						mipmaps: false
					})
				}
			],
			defines: {
				NORMAL_MIX_FROM: Config.TerrainNormalMixRange[0].toFixed(1),
				NORMAL_MIX_TO: Config.TerrainNormalMixRange[1].toFixed(1),
				USE_HEIGHT: '1',
				USAGE_TEXTURE_PADDING: Config.TerrainUsageTexturePadding.toFixed(1),
				TILE_SIZE: Config.TileSize.toFixed(10),
				DETAIL_UV_SCALE: Config.TerrainDetailUVScale.toFixed(10),
				// Strata Lane B (s15) — when a CUSTOM switcher ground is active, the worn "usage" overlay
				// near roads/buildings is sampled seamlessly from the base ground (de-tiled at the crisp
				// base scale) instead of the blurry plain-texture() forrest_ground at USED_TEXTURE_SCALE.
				// '0' = pristine engine default (GBufferPass.syncTerrainTexture flips it to '1' on a custom
				// selection + recompiles, so the default look is byte-for-byte untouched).
				WORN_DETILE: '0',
			},
			primitive: {
				frontFace: RendererTypes.FrontFace.CCW,
				cullMode: RendererTypes.CullMode.Back
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
			vertexShaderSource: Shaders.terrain.vertex,
			fragmentShaderSource: Shaders.terrain.fragment
		});
	}
}
