import AbstractMaterial from "~/lib/renderer/abstract-renderer/AbstractMaterial";
import AbstractMesh from "~/lib/renderer/abstract-renderer/AbstractMesh";
import {
	UniformFloat1,
	UniformFloat3,
	UniformFloat4,
	UniformInt1,
	UniformMatrix4,
	UniformTexture2DArray
} from "~/lib/renderer/abstract-renderer/Uniform";
import Tile from "../../objects/Tile";
import Mat4 from "~/lib/math/Mat4";
import Pass from "./Pass";
import RenderPassResource from "../render-graph/resources/RenderPassResource";
import {InternalResourceType} from '~/lib/render-graph/Pass';
import PassManager from '../PassManager';
import ExtrudedMeshMaterialContainer from "../materials/ExtrudedMeshMaterialContainer";
import SkyboxMaterialContainer from "../materials/SkyboxMaterialContainer";
import ProjectedMeshMaterialContainer from "../materials/ProjectedMeshMaterialContainer";
import FullScreenTriangle from "../../objects/FullScreenTriangle";
import TerrainMaterialContainer from "../materials/TerrainMaterialContainer";
import TreeMaterialContainer from "../materials/TreeMaterialContainer";
import Vec2 from "~/lib/math/Vec2";
import VehicleSystem from "../../systems/VehicleSystem";
import AircraftMaterialContainer from "../materials/AircraftMaterialContainer";
import AbstractTexture2D from "~/lib/renderer/abstract-renderer/AbstractTexture2D";
import MathUtils from "~/lib/math/MathUtils";
import Config from "../../Config";
import TerrainSystem from "../../systems/TerrainSystem";
import AbstractTexture2DArray from "~/lib/renderer/abstract-renderer/AbstractTexture2DArray";
import Camera from "~/lib/core/Camera";
import GenericInstanceMaterialContainer from "~/app/render/materials/GenericInstanceMaterialContainer";
import {
	InstanceStructure,
	Tile3DInstanceLODConfig,
	Tile3DInstanceType
} from "~/lib/tile-processing/tile3d/features/Tile3DInstance";
import AdvancedInstanceMaterialContainer from "~/app/render/materials/AdvancedInstanceMaterialContainer";
import {InstanceTextureIdList} from "~/app/render/textures/createInstanceTexture";
import MapTimeSystem from "~/app/systems/MapTimeSystem";
import {AircraftPartTextures} from "~/app/render/textures/createAircraftTexture";
import PerspectiveCamera from "~/lib/core/PerspectiveCamera";
import ControlsSystem from "~/app/systems/ControlsSystem";
import CarMaterialContainer from "~/app/render/materials/CarMaterialContainer";
import DeckMaterialContainer from "~/app/render/materials/DeckMaterialContainer";
import TreeModelMaterialContainer from "~/app/render/materials/TreeModelMaterialContainer";
import BuildingModelMaterialContainer from "~/app/render/materials/BuildingModelMaterialContainer";
import {placedBuildingsState} from "~/app/objects/models/placedBuildingsState";
import {computeBuildingPlacement} from "~/app/objects/models/buildingPlacement";
import {CarWheelMounts, WheelRadius} from "~/app/objects/models/CarModel";
import Car from "~/app/objects/Car";
import {bridgeRegistry} from "~/app/bridge/BridgeRegistry";
import {terrainTextureRegistry} from "~/app/render/materials/TerrainTextureRegistry";
import ResourceLoader from "~/app/world/ResourceLoader";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import {buildingCollisionRegistry, ModelFootprint} from "~/app/collision/BuildingCollisionRegistry";
import {polygonAABB} from "~/app/collision/FootprintCollision";
import Vec3 from "~/lib/math/Vec3";
import BridgeModelObject from "~/app/objects/BridgeModelObject";
import {BridgeCorridor} from "~/app/bridge/BridgeDeck";

// Below the deck by this much (world Y) the bridge towers stop colliding, so driving UNDER the bridge
// is free while on the deck you still can't cut through a tower leg.
const BridgeTowerCollisionYBand = 20;

export default class GBufferPass extends Pass<{
	GBufferRenderPass: {
		type: InternalResourceType.Output;
		resource: RenderPassResource;
	};
	TerrainNormal: {
		type: InternalResourceType.Input;
		resource: RenderPassResource;
	};
	TerrainWater: {
		type: InternalResourceType.Input;
		resource: RenderPassResource;
	};
	TerrainWaterTileMask: {
		type: InternalResourceType.Input;
		resource: RenderPassResource;
	};
	TerrainRingHeight: {
		type: InternalResourceType.Input;
		resource: RenderPassResource;
	};
	TerrainUsage: {
		type: InternalResourceType.Input;
		resource: RenderPassResource;
	};
	TerrainUsageTileMask: {
		type: InternalResourceType.Input;
		resource: RenderPassResource;
	};
}> {
	private extrudedMeshMaterial: AbstractMaterial;
	private projectedMeshMaterial: AbstractMaterial;
	private huggingMeshMaterial: AbstractMaterial;
	private skyboxMaterial: AbstractMaterial;
	private terrainMaterial: AbstractMaterial;
	private treeMaterial: AbstractMaterial;
	private genericInstanceMaterial: AbstractMaterial;
	private advancedInstanceMaterial: AbstractMaterial;
	private aircraftMaterial: AbstractMaterial;
	private carMaterial: AbstractMaterial;
	private deckMaterial: AbstractMaterial;
	// Strata Lane B (s10 models) — textured tree materials, one per texture resource (bark = opaque,
	// leaf = alpha cutout), cached + reused across species so adding a species needs no new field.
	private treeMaterials: Map<string, AbstractMaterial> = new Map();
	private buildingMaterials: Map<string, AbstractMaterial> = new Map();
	// Strata Lane B (s12) — live terrain base-ground texture switch. Cache one [color, normal]
	// Texture2DArray per ResourceLoader key (the constructor's array is seeded under its key);
	// `terrainTextureRevision` tracks the last applied registry revision so we only rebind on change.
	private terrainDetailMaps: Map<string, AbstractTexture2DArray> = new Map();
	// Strata Lane B (s12) — cache the two biome maps so a ground option can pick neutral (own color)
	// or regional (the engine's biome tint, needed to make the near-white original ground look right).
	private terrainBiomeMaps: Map<string, AbstractTexture2D> = new Map();
	private terrainTextureRevision = -1;
	private cameraMatrixWorldInversePrev: Mat4 = null;
	// Previous-frame car part matrices, for correct TAA motion vectors (index 0 = body/GLB, 1-4 = wheels).
	private carMatricesPrev: Mat4[] = [];
	// Previous-frame collision-debug-overlay origin-relative matrix, for its TAA motion vector.
	private collisionDebugMatrixPrev: Mat4 = null;
	// Signature of the last bridge-model placement the tower collision footprints were synced to.
	private bridgeFootprintSig: string = '';
	public objectIdBuffer: Uint32Array = new Uint32Array(1);
	public objectIdX = 0;
	public objectIdY = 0;
	private fullScreenTriangle: FullScreenTriangle;

	public constructor(manager: PassManager) {
		super('GBufferPass', manager, {
			GBufferRenderPass: {
				type: InternalResourceType.Output,
				resource: manager.getSharedResource('GBufferRenderPass')
			},
			TerrainNormal: {
				type: InternalResourceType.Input,
				resource: manager.getSharedResource('TerrainNormal')
			},
			TerrainWater: {
				type: InternalResourceType.Input,
				resource: manager.getSharedResource('TerrainWater')
			},
			TerrainWaterTileMask: {
				type: InternalResourceType.Input,
				resource: manager.getSharedResource('TerrainWaterTileMask')
			},
			TerrainRingHeight: {
				type: InternalResourceType.Input,
				resource: manager.getSharedResource('TerrainRingHeight')
			},
			TerrainUsage: {
				type: InternalResourceType.Input,
				resource: manager.getSharedResource('TerrainUsage')
			},
			TerrainUsageTileMask: {
				type: InternalResourceType.Input,
				resource: manager.getSharedResource('TerrainUsageTileMask')
			}
		});

		this.fullScreenTriangle = new FullScreenTriangle(this.renderer);

		this.createMaterials();
	}

	private createMaterials(): void {
		this.skyboxMaterial = new SkyboxMaterialContainer(this.renderer).material;
		this.terrainMaterial = new TerrainMaterialContainer(this.renderer).material;

		this.genericInstanceMaterial = new GenericInstanceMaterialContainer(this.renderer).material;
		this.genericInstanceMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('instance');

		this.advancedInstanceMaterial = new AdvancedInstanceMaterialContainer(this.renderer).material;
		this.advancedInstanceMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('instance');

		this.treeMaterial = new TreeMaterialContainer(this.renderer).material;
		this.treeMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('tree');

		this.projectedMeshMaterial = new ProjectedMeshMaterialContainer(this.renderer, false).material;
		this.projectedMeshMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('projectedMesh');

		this.huggingMeshMaterial = new ProjectedMeshMaterialContainer(this.renderer, true).material;
		this.huggingMeshMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('projectedMesh');

		this.extrudedMeshMaterial = new ExtrudedMeshMaterialContainer(this.renderer).material;
		this.extrudedMeshMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('extrudedMesh');

		this.aircraftMaterial = new AircraftMaterialContainer(this.renderer).material;
		this.aircraftMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('aircraft');

		this.carMaterial = new CarMaterialContainer(this.renderer).material;
		this.deckMaterial = new DeckMaterialContainer(this.renderer).material;

		// Strata Lane B (s12) — seed the terrain detail-map cache with the array the container already
		// built (base = 'aerialGrassColor', the default option) so a "revert to current grass" needs no
		// rebuild. Other base grounds are built lazily on first selection by syncTerrainTexture().
		this.terrainDetailMaps.set(
			'aerialGrassColor|genericTerrainNormal',
			this.terrainMaterial.getUniform<UniformTexture2DArray>('tDetailMaps').value as AbstractTexture2DArray
		);
		// Seed the neutral biome map the container already built (the s11 flat-170 identity tile).
		this.terrainBiomeMaps.set(
			'neutral',
			this.terrainMaterial.getUniform('tBiomeMap').value as AbstractTexture2D
		);
	}

	// Strata Lane B (s12) — rebind the terrain base-ground texture when the dev panel changes it.
	// Builds a [color, normal] Texture2DArray per diffuse+normal pair on first use: the Streets-GL
	// options pair their NATIVE normal map (lit relief = the high-res look); Poly Haven sets fall back
	// to the generic normal (EXR normals can't load in WebGL). No-op unless the registry's revision
	// moved, so it's cheap to call every terrain frame.
	private syncTerrainTexture(): void {
		if (terrainTextureRegistry.revision === this.terrainTextureRevision) {
			return;
		}
		this.terrainTextureRevision = terrainTextureRegistry.revision;

		const key = terrainTextureRegistry.currentResourceKey();
		const normalKey = terrainTextureRegistry.currentNormalKey();
		// Cache by diffuse+normal so an option that pairs a different normal gets its own array. Pairing
		// the engine textures with their REAL normals (not one shared flat one) is what restores the
		// lit surface relief that makes them read as high-res (Lever A).
		const cacheKey = `${key}|${normalKey}`;
		let array = this.terrainDetailMaps.get(cacheKey);
		if (!array) {
			array = this.renderer.createTexture2DArray({
				depth: 2,
				data: [
					ResourceLoader.get(key),
					ResourceLoader.get(normalKey),
				],
				anisotropy: 16,
				minFilter: RendererTypes.MinFilter.LinearMipmapLinear,
				magFilter: RendererTypes.MagFilter.Linear,
				wrap: RendererTypes.TextureWrap.Repeat,
				format: RendererTypes.TextureFormat.RGBA8Unorm,
				mipmaps: true
			});
			this.terrainDetailMaps.set(cacheKey, array);
		}

		this.terrainMaterial.getUniform<UniformTexture2DArray>('tDetailMaps').value = array;

		// Swap the biome map to match the ground: 'regional' restores the engine's biome tint (needed
		// for the near-white original ground), 'neutral' lets a colored Poly Haven set show as-is.
		const biomeMode = terrainTextureRegistry.currentBiome();
		let biome = this.terrainBiomeMaps.get(biomeMode);
		if (!biome) {
			biome = this.renderer.createTexture2D({
				anisotropy: 16,
				data: ResourceLoader.get(biomeMode === 'regional' ? 'biomeMap' : 'biomeNeutral'),
				minFilter: RendererTypes.MinFilter.Linear,
				magFilter: RendererTypes.MagFilter.Linear,
				wrap: RendererTypes.TextureWrap.Repeat,
				format: RendererTypes.TextureFormat.RGBA8Unorm,
				mipmaps: false
			});
			this.terrainBiomeMaps.set(biomeMode, biome);
		}
		this.terrainMaterial.getUniform('tBiomeMap').value = biome;

		// Strata Lane B (s15) — gate the seamless worn-overlay fix to CUSTOM grounds only. The default
		// option (options[0]) keeps the engine's original blurry-but-pristine near-road overlay so the
		// out-of-the-box look is byte-for-byte unchanged (the s12 mistake was altering the default). Any
		// other selection de-tiles the worn patch into the base ground via the WORN_DETILE shader branch.
		const isCustom = terrainTextureRegistry.currentId !== terrainTextureRegistry.options[0].id;
		const wornDetile = isCustom ? '1' : '0';
		if (this.terrainMaterial.defines.WORN_DETILE !== wornDetile) {
			this.terrainMaterial.defines.WORN_DETILE = wornDetile;
			this.terrainMaterial.recompile();
		}
	}

	// Lazily build + cache a tree-MODEL material for a texture resource (one per species' bark / leaf).
	// Named ...Model to avoid colliding with `treeMaterial` (the engine's instanced-billboard material).
	private treeModelMaterial(textureResource: string): AbstractMaterial {
		let mat = this.treeMaterials.get(textureResource);
		if (!mat) {
			mat = new TreeModelMaterialContainer(this.renderer, textureResource).material;
			this.treeMaterials.set(textureResource, mat);
		}
		return mat;
	}

	// Lazily build + cache a building material for a facade texture (keyed by the building's textureKey;
	// the decoded image comes from the loaded GLB via the placedBuildings object). One per facade.
	private buildingMaterial(textureKey: string, image: any): AbstractMaterial {
		let mat = this.buildingMaterials.get(textureKey);
		if (!mat) {
			mat = new BuildingModelMaterialContainer(this.renderer, image).material;
			this.buildingMaterials.set(textureKey, mat);
		}
		return mat;
	}

	private updateMaterialsDefines(): void {
		const useHeight = this.manager.settings.get('terrainHeight').statusValue === 'on' ? '1' : '0';
		const materials = [
			this.huggingMeshMaterial,
			this.projectedMeshMaterial,
			this.terrainMaterial
		];

		for (const material of materials) {
			if (material.defines.USE_HEIGHT !== useHeight) {
				material.defines.USE_HEIGHT = useHeight;
				material.recompile();
			}
		}
	}

	private getTileNormalTexturesTransforms(tile: Tile): [Float32Array, Float32Array] {
		const terrainSystem = this.manager.systemManager.getSystem(TerrainSystem);
		const transform0 = new Float32Array(4);
		const transform1 = new Float32Array(4);

		terrainSystem.areaLoaders.height0.transformToArray(
			tile.position.x,
			tile.position.z,
			Config.TileSize,
			transform0
		);
		terrainSystem.areaLoaders.height1.transformToArray(
			tile.position.x,
			tile.position.z,
			Config.TileSize,
			transform1
		);

		return [transform0, transform1];
	}

	private getCameraPositionRelativeToTile(camera: Camera, tile: Tile): [number, number] {
		return [
			camera.position.x - tile.position.x + Config.TileSize / 2,
			camera.position.z - tile.position.z + Config.TileSize / 2
		];
	}

	private renderSkybox(): void {
		const camera = this.manager.sceneSystem.objects.camera;
		const skybox = this.manager.sceneSystem.objects.skybox;
		const skyRotationMatrix = new Float32Array(this.manager.mapTimeSystem.skyDirectionMatrix.values);

		this.skyboxMaterial.getUniform('projectionMatrix', 'Uniforms').value =
			new Float32Array(camera.projectionMatrix.values);
		this.skyboxMaterial.getUniform('modelViewMatrix', 'Uniforms').value =
			new Float32Array(Mat4.multiply(camera.matrixWorldInverse, skybox.matrixWorld).values);
		this.skyboxMaterial.getUniform('viewMatrix', 'Uniforms').value = new Float32Array(camera.matrixWorld.values);
		this.skyboxMaterial.getUniform('skyRotationMatrix', 'Uniforms').value = skyRotationMatrix;
		this.skyboxMaterial.updateUniformBlock('Uniforms');

		this.renderer.useMaterial(this.skyboxMaterial);

		skybox.draw();
	}

	private renderExtrudedMeshes(): void {
		const windowLightThreshold = this.manager.systemManager.getSystem(MapTimeSystem).windowLightThreshold;
		const camera = this.manager.sceneSystem.objects.camera;
		const tiles = this.manager.sceneSystem.objects.tiles;

		this.renderer.useMaterial(this.extrudedMeshMaterial);

		this.extrudedMeshMaterial.getUniform('projectionMatrix', 'PerMaterial').value = new Float32Array(camera.jitteredProjectionMatrix.values);
		this.extrudedMeshMaterial.getUniform<UniformFloat1>('windowLightThreshold', 'PerMaterial').value[0] = windowLightThreshold;
		this.extrudedMeshMaterial.updateUniformBlock('PerMaterial');

		for (const tile of tiles) {
			if (!tile.extrudedMesh || !tile.extrudedMesh.inCameraFrustum(camera)) {
				continue;
			}

			const mvMatrix = Mat4.multiply(camera.matrixWorldInverse, tile.matrixWorld);
			const mvMatrixPrev = Mat4.multiply(this.cameraMatrixWorldInversePrev, tile.matrixWorld);

			this.extrudedMeshMaterial.getUniform('modelViewMatrix', 'PerMesh').value = new Float32Array(mvMatrix.values);
			this.extrudedMeshMaterial.getUniform('modelViewMatrixPrev', 'PerMesh').value = new Float32Array(mvMatrixPrev.values);
			this.extrudedMeshMaterial.getUniform<UniformFloat1>('tileId', 'PerMesh').value[0] = tile.localId;
			this.extrudedMeshMaterial.updateUniformBlock('PerMesh');

			tile.extrudedMesh.draw();
		}
	}

	private renderTerrain(): void {
		const camera = this.manager.sceneSystem.objects.camera;
		const terrain = this.manager.sceneSystem.objects.terrain;
		const terrainNormal = <AbstractTexture2DArray>this.getPhysicalResource('TerrainNormal').colorAttachments[0].texture;
		const terrainWater = <AbstractTexture2DArray>this.getPhysicalResource('TerrainWater').colorAttachments[0].texture;
		const terrainWaterTileMask = <AbstractTexture2D>this.getPhysicalResource('TerrainWaterTileMask').colorAttachments[0].texture;
		const terrainUsage = <AbstractTexture2DArray>this.getPhysicalResource('TerrainUsage').colorAttachments[0].texture;
		const terrainUsageTileMask = <AbstractTexture2D>this.getPhysicalResource('TerrainUsageTileMask').colorAttachments[0].texture;
		const terrainRingHeight = <AbstractTexture2DArray>this.getPhysicalResource('TerrainRingHeight').colorAttachments[0].texture;
		const biomePos = MathUtils.meters2tile(camera.position.x, camera.position.z, 0);

		this.syncTerrainTexture();
		this.terrainMaterial.getUniform('tRingHeight').value = terrainRingHeight;
		this.terrainMaterial.getUniform('tNormal').value = terrainNormal;
		this.terrainMaterial.getUniform('tWater').value = terrainWater;
		this.terrainMaterial.getUniform('tWaterMask').value = terrainWaterTileMask;
		this.terrainMaterial.getUniform('tUsage').value = terrainUsage;
		this.terrainMaterial.getUniform('tUsageMask').value = terrainUsageTileMask;
		this.renderer.useMaterial(this.terrainMaterial);

		this.terrainMaterial.getUniform<UniformMatrix4>('projectionMatrix', 'PerMaterial').value =
			new Float32Array(camera.jitteredProjectionMatrix.values);
		this.terrainMaterial.getUniform('biomeCoordinates', 'PerMaterial').value = new Float32Array([biomePos.x, biomePos.y]);
		this.terrainMaterial.getUniform<UniformFloat1>('time', 'PerMaterial').value[0] = performance.now() * 0.001;
		// @ts-ignore
		this.terrainMaterial.getUniform<UniformFloat1>('usageRange', 'PerMaterial').value[0] = window.from ?? 0;
		// @ts-ignore
		this.terrainMaterial.getUniform<UniformFloat1>('usageRange', 'PerMaterial').value[1] = window.to ?? 0;
		// Strata Lane B (s15) — live base-terrain tiling from the dev panel (1.0 = pristine default).
		this.terrainMaterial.getUniform<UniformFloat1>('detailScale', 'PerMaterial').value[0] = terrainTextureRegistry.detailScale;
		this.terrainMaterial.updateUniformBlock('PerMaterial');

		for (let i = 0; i < terrain.children.length; i++) {
			const ring = terrain.children[i];
			const offsetSize = Config.TileSize * Config.TerrainDetailUVScale;
			const detailOffsetX = ring.position.x % offsetSize - ring.size / 2;
			const detailOffsetY = ring.position.z % offsetSize - ring.size / 2;

			this.terrainMaterial.getUniform<UniformMatrix4>('modelViewMatrix', 'PerMesh').value =
				new Float32Array(Mat4.multiply(camera.matrixWorldInverse, ring.matrixWorld).values);
			this.terrainMaterial.getUniform<UniformMatrix4>('modelViewMatrixPrev', 'PerMesh').value =
				new Float32Array(Mat4.multiply(this.cameraMatrixWorldInversePrev, ring.matrixWorld).values);
			this.terrainMaterial.getUniform<UniformFloat3>('transformNormal0', 'PerMesh').value = ring.heightTextureTransform0;
			this.terrainMaterial.getUniform<UniformFloat3>('transformNormal1', 'PerMesh').value = ring.heightTextureTransform1;
			this.terrainMaterial.getUniform<UniformFloat4>('transformWater0', 'PerMesh').value = ring.waterTextureTransform0;
			this.terrainMaterial.getUniform<UniformFloat4>('transformWater1', 'PerMesh').value = ring.waterTextureTransform1;
			this.terrainMaterial.getUniform<UniformFloat3>('transformMask', 'PerMesh').value = ring.maskTextureTransform;
			this.terrainMaterial.getUniform<UniformFloat1>('size', 'PerMesh').value[0] = ring.size;
			this.terrainMaterial.getUniform<UniformFloat1>('segmentCount', 'PerMesh').value[0] = ring.segmentCount * 2;
			this.terrainMaterial.getUniform('detailTextureOffset', 'PerMesh').value = new Float32Array([
				detailOffsetX,
				detailOffsetY
			]);
			this.terrainMaterial.getUniform('cameraPosition', 'PerMesh').value = new Float32Array([
				camera.position.x - ring.position.x, camera.position.z - ring.position.z
			]);
			this.terrainMaterial.getUniform<UniformInt1>('levelId', 'PerMesh').value[0] = i;
			this.terrainMaterial.updateUniformBlock('PerMesh');

			ring.draw();
		}
	}

	private getTileDetailTextureOffset(tile: Tile): Float32Array {
		const offsetSize = Config.TileSize * Config.TerrainDetailUVScale;
		const detailOffsetX = tile.position.x % offsetSize;
		const detailOffsetY = tile.position.z % offsetSize;

		return new Float32Array([detailOffsetX, detailOffsetY]);
	}

	private renderProjectedMeshes(): void {
		const camera = this.manager.sceneSystem.objects.camera;
		const tiles = this.manager.sceneSystem.objects.tiles;
		const terrain = this.manager.sceneSystem.objects.terrain;

		const terrainNormal = <AbstractTexture2DArray>this.getPhysicalResource('TerrainNormal').colorAttachments[0].texture;
		const terrainRingHeight = <AbstractTexture2DArray>this.getPhysicalResource('TerrainRingHeight').colorAttachments[0].texture;

		this.projectedMeshMaterial.getUniform('tRingHeight').value = terrainRingHeight;
		this.projectedMeshMaterial.getUniform('tNormal').value = terrainNormal;

		this.renderer.useMaterial(this.projectedMeshMaterial);

		this.projectedMeshMaterial.getUniform<UniformMatrix4>('projectionMatrix', 'PerMaterial').value = new Float32Array(camera.jitteredProjectionMatrix.values);
		this.projectedMeshMaterial.updateUniformBlock('PerMaterial');

		for (const tile of tiles) {
			if (!tile.projectedMesh || !tile.projectedMesh.inCameraFrustum(camera)) {
				continue;
			}

			const tileParams = terrain.getTileParams(tile);

			if (!tileParams) {
				continue;
			}

			const {ring0, levelId, ring0Offset, ring1Offset} = tileParams;
			const normalTextureTransforms = this.getTileNormalTexturesTransforms(tile);
			const detailTextureOffset = this.getTileDetailTextureOffset(tile);

			const mvMatrix = Mat4.multiply(camera.matrixWorldInverse, tile.matrixWorld);
			const mvMatrixPrev = Mat4.multiply(this.cameraMatrixWorldInversePrev, tile.matrixWorld);
			const relativeCameraPosition = this.getCameraPositionRelativeToTile(camera, tile);

			this.projectedMeshMaterial.getUniform('modelViewMatrix', 'PerMesh').value = new Float32Array(mvMatrix.values);
			this.projectedMeshMaterial.getUniform('modelViewMatrixPrev', 'PerMesh').value = new Float32Array(mvMatrixPrev.values);
			this.projectedMeshMaterial.getUniform('transformNormal0', 'PerMesh').value = normalTextureTransforms[0];
			this.projectedMeshMaterial.getUniform('transformNormal1', 'PerMesh').value = normalTextureTransforms[1];
			this.projectedMeshMaterial.getUniform<UniformFloat1>('terrainRingSize', 'PerMesh').value[0] = ring0.size;
			this.projectedMeshMaterial.getUniform('terrainRingOffset', 'PerMesh').value = new Float32Array([
				ring0Offset.x, ring0Offset.y, ring1Offset.x, ring1Offset.y
			]);
			this.projectedMeshMaterial.getUniform<UniformFloat1>('terrainLevelId', 'PerMesh').value[0] = levelId;
			this.projectedMeshMaterial.getUniform<UniformFloat1>('segmentCount', 'PerMesh').value[0] = ring0.segmentCount * 2;
			this.projectedMeshMaterial.getUniform('cameraPosition', 'PerMesh').value = new Float32Array(relativeCameraPosition);
			this.projectedMeshMaterial.getUniform('detailTextureOffset', 'PerMesh').value = detailTextureOffset;
			this.projectedMeshMaterial.getUniform<UniformFloat1>('time', 'PerMaterial').value[0] = performance.now() * 0.001;

			this.projectedMeshMaterial.updateUniformBlock('PerMesh');

			tile.projectedMesh.draw();
		}
	}

	private renderHuggingMeshes(): void {
		const camera = this.manager.sceneSystem.objects.camera;
		const tiles = this.manager.sceneSystem.objects.tiles;
		const terrain = this.manager.sceneSystem.objects.terrain;

		const terrainNormal = <AbstractTexture2DArray>this.getPhysicalResource('TerrainNormal').colorAttachments[0].texture;
		const terrainRingHeight = <AbstractTexture2DArray>this.getPhysicalResource('TerrainRingHeight').colorAttachments[0].texture;

		this.huggingMeshMaterial.getUniform('tRingHeight').value = terrainRingHeight;
		this.huggingMeshMaterial.getUniform('tNormal').value = terrainNormal;

		this.renderer.useMaterial(this.huggingMeshMaterial);

		this.huggingMeshMaterial.getUniform<UniformMatrix4>('projectionMatrix', 'PerMaterial').value = new Float32Array(camera.jitteredProjectionMatrix.values);
		this.huggingMeshMaterial.updateUniformBlock('PerMaterial');

		for (const tile of tiles) {
			if (!tile.huggingMesh || !tile.huggingMesh.inCameraFrustum(camera)) {
				continue;
			}

			const tileParams = terrain.getTileParams(tile);

			if (!tileParams) {
				continue;
			}

			const {ring0, levelId, ring0Offset, ring1Offset} = tileParams;
			const normalTextureTransforms = this.getTileNormalTexturesTransforms(tile);

			const mvMatrix = Mat4.multiply(camera.matrixWorldInverse, tile.matrixWorld);
			const mvMatrixPrev = Mat4.multiply(this.cameraMatrixWorldInversePrev, tile.matrixWorld);
			const relativeCameraPosition = this.getCameraPositionRelativeToTile(camera, tile);

			this.huggingMeshMaterial.getUniform('modelViewMatrix', 'PerMesh').value = new Float32Array(mvMatrix.values);
			this.huggingMeshMaterial.getUniform('modelViewMatrixPrev', 'PerMesh').value = new Float32Array(mvMatrixPrev.values);
			this.huggingMeshMaterial.getUniform('transformNormal0', 'PerMesh').value = normalTextureTransforms[0];
			this.huggingMeshMaterial.getUniform('transformNormal1', 'PerMesh').value = normalTextureTransforms[1];
			this.huggingMeshMaterial.getUniform<UniformFloat1>('terrainRingSize', 'PerMesh').value[0] = ring0.size;
			this.huggingMeshMaterial.getUniform('terrainRingOffset', 'PerMesh').value = new Float32Array([
				ring0Offset.x, ring0Offset.y, ring1Offset.x, ring1Offset.y
			]);
			this.huggingMeshMaterial.getUniform<UniformFloat1>('terrainLevelId', 'PerMesh').value[0] = levelId;
			this.huggingMeshMaterial.getUniform<UniformFloat1>('segmentCount', 'PerMesh').value[0] = ring0.segmentCount * 2;
			this.huggingMeshMaterial.getUniform('cameraPosition', 'PerMesh').value = new Float32Array(relativeCameraPosition);
			this.huggingMeshMaterial.getUniform<UniformFloat1>('time', 'PerMaterial').value[0] = performance.now() * 0.001;
			this.huggingMeshMaterial.updateUniformBlock('PerMesh');

			tile.huggingMesh.draw();
		}
	}

	private renderInstances(instancesOrigin: Vec2): void {
		const camera = this.manager.sceneSystem.objects.camera;
		const tiles = this.manager.sceneSystem.objects.tiles;

		this.manager.sceneSystem.updateInstancedObjectsBuffers(tiles, camera, instancesOrigin);

		for (const [name, instancedObject] of this.manager.sceneSystem.objects.instancedObjects.entries()) {
			if (instancedObject.instanceCount === 0) {
				continue;
			}

			const materials: Record<InstanceStructure, AbstractMaterial> = {
				[InstanceStructure.Tree]: this.treeMaterial,
				[InstanceStructure.Generic]: this.genericInstanceMaterial,
				[InstanceStructure.Advanced]: this.advancedInstanceMaterial
			};

			const config = Tile3DInstanceLODConfig[name as Tile3DInstanceType];
			const material = materials[config.structure];
			const mvMatrixPrev = Mat4.multiply(this.cameraMatrixWorldInversePrev, instancedObject.matrixWorld);

			this.renderer.useMaterial(material);

			material.getUniform('projectionMatrix', 'MainBlock').value = new Float32Array(camera.jitteredProjectionMatrix.values);
			material.getUniform('modelMatrix', 'MainBlock').value = new Float32Array(instancedObject.matrixWorld.values);
			material.getUniform('viewMatrix', 'MainBlock').value = new Float32Array(camera.matrixWorldInverse.values);
			material.getUniform('modelViewMatrixPrev', 'MainBlock').value = new Float32Array(mvMatrixPrev.values);
			material.updateUniformBlock('MainBlock');

			const textureIdUniform = material.getUniform('textureId', 'PerInstanceType');

			if (textureIdUniform) {
				textureIdUniform.value = new Float32Array([InstanceTextureIdList[name as Tile3DInstanceType]]);
				material.updateUniformBlock('PerInstanceType');
			}

			instancedObject.mesh.draw();
		}
	}

	private renderAircraft(instancesOrigin: Vec2): void {
		const camera = this.manager.sceneSystem.objects.camera;
		const aircraftObjects = this.manager.sceneSystem.objects.instancedAircraftParts;
		const vehicleSystem = this.manager.systemManager.getSystem(VehicleSystem);

		vehicleSystem.updateBuffers(instancesOrigin);

		const buffers = vehicleSystem.aircraftPartsBuffers;

		for (const [partType, buffer] of buffers.entries()) {
			const object = aircraftObjects.get(partType);

			if (!object) {
				continue;
			}

			const instanceCount = buffer.length / 6;

			object.position.set(instancesOrigin.x, 0, instancesOrigin.y);
			object.updateMatrix();
			object.updateMatrixWorld();
			object.setInstancesInterleavedBuffer(buffer, instanceCount);

			if (instanceCount === 0) {
				continue;
			}

			const texture = AircraftPartTextures[partType];
			const mvMatrixPrev = Mat4.multiply(this.cameraMatrixWorldInversePrev, object.matrixWorld);

			this.renderer.useMaterial(this.aircraftMaterial);

			this.aircraftMaterial.getUniform('projectionMatrix', 'MainBlock').value = new Float32Array(camera.jitteredProjectionMatrix.values);
			this.aircraftMaterial.getUniform('modelMatrix', 'MainBlock').value = new Float32Array(object.matrixWorld.values);
			this.aircraftMaterial.getUniform('viewMatrix', 'MainBlock').value = new Float32Array(camera.matrixWorldInverse.values);
			this.aircraftMaterial.getUniform('modelViewMatrixPrev', 'MainBlock').value = new Float32Array(mvMatrixPrev.values);
			this.aircraftMaterial.getUniform('textureId', 'MainBlock').value = new Float32Array([texture]);
			this.aircraftMaterial.updateUniformBlock('MainBlock');

			object.mesh.draw();
		}
	}

	// Strata Phase 2 Increment 4 — THROWAWAY GLUE. Draw the car at the driven point as separate
	// parts: a body with the FULL transform matrix (yaw + pitch + roll, hugs the terrain) plus four
	// wheels, each with its own part matrix on top (spin + steer + per-wheel suspension). No moat
	// code here; entirely renderer-specific and disposable.
	private renderCar(instancesOrigin: Vec2): void {
		const controlsSystem = this.manager.systemManager.getSystem(ControlsSystem);

		if (!controlsSystem.isDriveActive) {
			return;
		}

		const camera = this.manager.sceneSystem.objects.camera;
		const car = this.manager.sceneSystem.objects.car;

		if (!car.isMeshReady()) {
			return;
		}

		const pose = controlsSystem.getDriveCarPose();

		// Car mesh is built nose-along-+X; yaw = -heading maps that to the driving direction.
		// CarHeadingOffset is a tuning knob if the nose ends up sideways/backwards.
		const CarHeadingOffset = 0;
		const yaw = -pose.heading + CarHeadingOffset;

		// modelMatrix = pure translation by instancesOrigin (precision pivot, kept on the GPU
		// separate from viewMatrix). The origin-relative transforms are built in double precision
		// here; the (pose - origin) translation stays small => no float jitter.
		// Order T * Ryaw * Rpitch * Rroll: roll about the nose, then pitch about the lateral
		// axis, then yaw about up — the natural vehicle order.
		const buildCarMatrix = (y: number, pitch: number, roll: number): Mat4 => {
			let m = Mat4.identity();
			m = Mat4.translate(m, pose.x - instancesOrigin.x, y, pose.z - instancesOrigin.y);
			m = Mat4.yRotate(m, yaw);
			m = Mat4.zRotate(m, pitch);
			m = Mat4.xRotate(m, roll);
			return m;
		};

		// carMatrix = ground pose — the WHEELS ride this, always planted on the terrain.
		// bodyMatrix = the sprung body pose (smoothed heave + weight-transfer/boost lean), applied
		// to the BODY mesh only so the wheels stay on the ground while the body bounces (ATV split).
		const carMatrix = buildCarMatrix(pose.y, pose.pitch, pose.roll);
		const bodyMatrix = buildCarMatrix(pose.bodyY, pose.bodyPitch, pose.bodyRoll);

		car.position.set(instancesOrigin.x, 0, instancesOrigin.y);
		car.updateMatrix();
		car.updateMatrixWorld();

		const material = this.carMaterial;
		const mvMatrixPrev = Mat4.multiply(this.cameraMatrixWorldInversePrev, car.matrixWorld);

		this.renderer.useMaterial(material);

		// Per-material uniforms are set once; only carMatrix changes per part below.
		material.getUniform('projectionMatrix', 'MainBlock').value = new Float32Array(camera.jitteredProjectionMatrix.values);
		material.getUniform('modelMatrix', 'MainBlock').value = new Float32Array(car.matrixWorld.values);
		material.getUniform('viewMatrix', 'MainBlock').value = new Float32Array(camera.matrixWorldInverse.values);
		material.getUniform('modelViewMatrixPrev', 'MainBlock').value = new Float32Array(mvMatrixPrev.values);

		// Sets carMatrix + the previous-frame carMatrix (slot's last value, or current on the first
		// frame) so the motion vector captures the car's own movement => no TAA flicker when driving.
		const drawPart = (slot: number, m: Mat4, mesh: AbstractMesh): void => {
			const prev = this.carMatricesPrev[slot] ?? m;
			material.getUniform('carMatrix', 'MainBlock').value = new Float32Array(m.values);
			material.getUniform('carMatrixPrev', 'MainBlock').value = new Float32Array(prev.values);
			material.updateUniformBlock('MainBlock');
			mesh.draw();
			this.carMatricesPrev[slot] = m;
		};

		// Step B: the dropped GLB, split into body + 4 axle-centered wheels, animated by the same rig.
		if (Car.useGLB && car.glbReady) {
			drawPart(0, bodyMatrix, car.glbBodyMesh);

			// GLB wheels are bigger than the procedural ones; rescale spin to the real radius so the
			// roll matches ground speed (pose.wheelSpin = distance / WheelRadius). Front and rear get
			// separate spins so a stationary donut spins ONLY the rears (front = wheelSpin, rear =
			// rearWheelSpin which carries the burnout).
			const radiusScale = WheelRadius / (car.glbWheelRadius || WheelRadius);
			const glbSpin = pose.wheelSpin * radiusScale;
			const glbRearSpin = pose.rearWheelSpin * radiusScale;

			for (let i = 0; i < car.glbWheels.length; i++) {
				const w = car.glbWheels[i];
				const mesh = car.glbWheelMeshes[i];
				if (!w || !mesh) continue;

				const susp = pose.suspension[i] ?? 0;

				let wheelMatrix = Mat4.identity();
				wheelMatrix = Mat4.translate(wheelMatrix, w.mountX, w.mountY + susp, w.mountZ);
				if (w.front) wheelMatrix = Mat4.yRotate(wheelMatrix, pose.steerAngle);
				wheelMatrix = Mat4.zRotate(wheelMatrix, w.front ? glbSpin : glbRearSpin);

				drawPart(i + 1, Mat4.multiply(carMatrix, wheelMatrix), mesh);
			}

			return;
		}

		// Body (leans on its springs; wheels below stay on the ground).
		drawPart(0, bodyMatrix, car.bodyMesh);

		// Four wheels, each = carMatrix * (translate to mount + suspension) * steer(Y) * spin(Z).
		// The wheel mesh is centred on its axle, so spin is a clean Z-rotation.
		for (let i = 0; i < CarWheelMounts.length; i++) {
			const mount = CarWheelMounts[i];
			const susp = pose.suspension[i] ?? 0;

			let wheelMatrix = Mat4.identity();
			wheelMatrix = Mat4.translate(wheelMatrix, mount.x, WheelRadius + susp, mount.z);

			if (mount.front) {
				wheelMatrix = Mat4.yRotate(wheelMatrix, pose.steerAngle);
			}

			// Front = rolling spin; rear = rearWheelSpin (carries the stationary-donut burnout).
			wheelMatrix = Mat4.zRotate(wheelMatrix, mount.front ? pose.wheelSpin : pose.rearWheelSpin);

			const fullMatrix = Mat4.multiply(carMatrix, wheelMatrix);

			drawPart(i + 1, fullMatrix, car.wheelMesh);
		}
	}

	// Strata Lane B Increment 3 — draw the VISIBLE bridge deck. The DeckRibbon's mesh is baked in
	// world coords relative to its anchor; here we finish the precision pivot exactly like the car:
	// modelMatrix translates by the instances origin and deckMatrix translates by (anchor - origin),
	// both kept small / in double precision so the deck doesn't jitter. Reuses the Car material (a
	// plain per-vertex-color GBuffer material).
	private renderDeck(instancesOrigin: Vec2): void {
		// Draw the deck whenever a corridor exists, in every mode — GGB shows its elevated deck on
		// load and while driving alike (one fully-rendered view). The tile pipeline suppresses the
		// flat draped roadway for decked bridge ways, so there is no phantom road beneath it.
		// courseMode/L still gates only the builder panel and the car's deck-height physics.
		if (bridgeRegistry.corridors.length === 0) {
			return;
		}

		const deck = this.manager.sceneSystem.objects.deckRibbon;

		// (Re)build the ribbon against the real terrain when the registry changed or tiles under the
		// ramps just loaded, so the drawn deck blends to the ground exactly like the car's query.
		if (deck.needsRebuild()) {
			const terrainHeightProvider = this.manager.systemManager.getSystem(TerrainSystem).terrainHeightProvider;
			deck.rebuild(this.renderer, (x, z) => terrainHeightProvider.getHeightGlobalInterpolated(x, z, true));
		}

		if (deck.decks.length === 0) {
			return;
		}

		const camera = this.manager.sceneSystem.objects.camera;

		// All deck meshes share one modelMatrix (the instances-origin translate); each corridor's mesh
		// then carries its OWN carMatrix = translate(anchor - origin) to finish the precision pivot.
		deck.position.set(instancesOrigin.x, 0, instancesOrigin.y);
		deck.updateMatrix();
		deck.updateMatrixWorld();

		const material = this.deckMaterial;
		const mvMatrixPrev = Mat4.multiply(this.cameraMatrixWorldInversePrev, deck.matrixWorld);

		this.renderer.useMaterial(material);

		material.getUniform('projectionMatrix', 'MainBlock').value = new Float32Array(camera.jitteredProjectionMatrix.values);
		material.getUniform('modelMatrix', 'MainBlock').value = new Float32Array(deck.matrixWorld.values);
		material.getUniform('viewMatrix', 'MainBlock').value = new Float32Array(camera.matrixWorldInverse.values);
		material.getUniform('modelViewMatrixPrev', 'MainBlock').value = new Float32Array(mvMatrixPrev.values);

		for (const corridorDeck of deck.decks) {
			// Origin-relative translate: the mesh holds (vertex - anchor); this puts it back at (vertex -
			// origin) so modelMatrix's +origin translation lands it at the true world position. The deck
			// is static, so carMatrixPrev == carMatrix (no per-object motion vector).
			let deckMatrix = Mat4.identity();
			deckMatrix = Mat4.translate(
				deckMatrix,
				corridorDeck.anchor[0] - instancesOrigin.x,
				0,
				corridorDeck.anchor[1] - instancesOrigin.y
			);

			material.getUniform('carMatrix', 'MainBlock').value = new Float32Array(deckMatrix.values);
			material.getUniform('carMatrixPrev', 'MainBlock').value = new Float32Array(deckMatrix.values);
			material.updateUniformBlock('MainBlock');

			corridorDeck.mesh.draw();
		}
	}

	// Strata physics spike — the building-collision debug overlay. Red footprint decals showing exactly
	// the convex polygons the car is pushed out of, so the user can see how far the boundary reaches vs
	// the drawn building. Gated on buildingCollisionRegistry.showDebug; rebuilds from the registry (as
	// tiles stream) against the real terrain, like the deck. Reuses the car vertex-colour material.
	private renderCollisionDebug(instancesOrigin: Vec2): void {
		if (!buildingCollisionRegistry.showDebug) {
			return;
		}

		const overlay = this.manager.sceneSystem.objects.collisionDebug;
		const camera = this.manager.sceneSystem.objects.camera;

		const terrainHeightProvider = this.manager.systemManager.getSystem(TerrainSystem).terrainHeightProvider;
		overlay.maybeRebuild(
			this.renderer,
			(x, z) => terrainHeightProvider.getHeightGlobalInterpolated(x, z, true),
			camera.position.x,
			camera.position.z
		);

		if (!overlay.mesh) {
			return;
		}

		let debugMatrix = Mat4.identity();
		debugMatrix = Mat4.translate(
			debugMatrix,
			overlay.anchor[0] - instancesOrigin.x,
			0,
			overlay.anchor[1] - instancesOrigin.y
		);

		overlay.position.set(instancesOrigin.x, 0, instancesOrigin.y);
		overlay.updateMatrix();
		overlay.updateMatrixWorld();

		const material = this.carMaterial;
		const mvMatrixPrev = Mat4.multiply(this.cameraMatrixWorldInversePrev, overlay.matrixWorld);
		const prev = this.collisionDebugMatrixPrev ?? debugMatrix;

		this.renderer.useMaterial(material);

		material.getUniform('projectionMatrix', 'MainBlock').value = new Float32Array(camera.jitteredProjectionMatrix.values);
		material.getUniform('modelMatrix', 'MainBlock').value = new Float32Array(overlay.matrixWorld.values);
		material.getUniform('viewMatrix', 'MainBlock').value = new Float32Array(camera.matrixWorldInverse.values);
		material.getUniform('modelViewMatrixPrev', 'MainBlock').value = new Float32Array(mvMatrixPrev.values);
		material.getUniform('carMatrix', 'MainBlock').value = new Float32Array(debugMatrix.values);
		material.getUniform('carMatrixPrev', 'MainBlock').value = new Float32Array(prev.values);
		material.updateUniformBlock('MainBlock');

		overlay.mesh.draw();

		this.collisionDebugMatrixPrev = debugMatrix;
	}

	// Strata Lane B Increment 9 — the GGB hero model. A decoupled VISUAL prop placed over the drivable
	// deck from the corridor's model* tunables (panel sliders). Origin-relative precision pivot like the
	// deck/car: the mesh is centered on its own bbox, the carMatrix uniform carries
	// translate(anchor - origin + offset) * yaw * scale, modelMatrix re-adds the origin. Reuses the car
	// vertex-colour material (the model is fully baseColorFactor-coloured). Best-effort; never gates drive.
	private renderBridgeModel(instancesOrigin: Vec2): void {
		const model = this.manager.sceneSystem.objects.bridgeModel;
		const corridors = bridgeRegistry.corridors;

		// Tower-collision footprints stay tied to the GGB corridor (the parked feature) — keep syncing
		// the first corridor. Cheap: only recomputes when the signature changes.
		const ggb = corridors[0];
		const sig = `${bridgeRegistry.revision}:${model.legFootprints.length}:${ggb?.modelEnabled ? 1 : 0}`;
		if (sig !== this.bridgeFootprintSig) {
			this.bridgeFootprintSig = sig;
			this.syncBridgeModelFootprints(ggb, model);
		}

		if (!model.mesh) {
			return;
		}

		const camera = this.manager.sceneSystem.objects.camera;
		const material = this.carMaterial;

		// All hero models share one mesh (the GGB GLB) + one modelMatrix (the origin translate); each
		// corridor that enables a model draws it with its OWN placement transform via carMatrix. Reusing
		// the same GLB is intentional — the Bay Bridge West span is a suspension bridge too (s14).
		model.position.set(instancesOrigin.x, 0, instancesOrigin.y);
		model.updateMatrix();
		model.updateMatrixWorld();
		const mvMatrixPrev = Mat4.multiply(this.cameraMatrixWorldInversePrev, model.matrixWorld);

		this.renderer.useMaterial(material);
		material.getUniform('projectionMatrix', 'MainBlock').value = new Float32Array(camera.jitteredProjectionMatrix.values);
		material.getUniform('modelMatrix', 'MainBlock').value = new Float32Array(model.matrixWorld.values);
		material.getUniform('viewMatrix', 'MainBlock').value = new Float32Array(camera.matrixWorldInverse.values);
		material.getUniform('modelViewMatrixPrev', 'MainBlock').value = new Float32Array(mvMatrixPrev.values);

		for (const corridor of corridors) {
			if (!corridor || !corridor.modelEnabled || !corridor.modelAnchor) {
				continue;
			}

			const scale = corridor.modelScale ?? 1;
			const stretch = corridor.modelStretch ?? 1;
			const yaw = corridor.modelYaw ?? 0;
			const [ax, az] = corridor.modelAnchor;

			// translate(anchor - origin + offset) * yaw * scale, applied to the origin-centered mesh.
			// The model is static, so carMatrixPrev == carMatrix (no per-object motion vector).
			let bridgeMatrix = Mat4.identity();
			bridgeMatrix = Mat4.translate(
				bridgeMatrix,
				ax - instancesOrigin.x + (corridor.modelOffsetX ?? 0),
				corridor.modelOffsetY ?? 0,
				az - instancesOrigin.y + (corridor.modelOffsetZ ?? 0)
			);
			bridgeMatrix = Mat4.yRotate(bridgeMatrix, yaw);
			bridgeMatrix = Mat4.scale(bridgeMatrix, scale * stretch, scale, scale);

			material.getUniform('carMatrix', 'MainBlock').value = new Float32Array(bridgeMatrix.values);
			material.getUniform('carMatrixPrev', 'MainBlock').value = new Float32Array(bridgeMatrix.values);
			material.updateUniformBlock('MainBlock');

			model.mesh.draw();
		}
	}

	// Strata Lane B (s11) — draw the world-wide model-tree scatter: per-tile clusters built from the
	// engine's OSM forest 'tree' buffers, near-camera only. Reconciles the resident clusters first
	// (build/teardown by distance), then draws each tile's species bark+leaf meshes. Same precision
	// pivot as renderTreeCluster: one shared modelMatrix at the origin, a per-tile carMatrix carrying
	// translate(tileAnchor - origin). Trees are static, so carMatrixPrev == carMatrix (no object motion).
	private renderWorldTreeScatter(instancesOrigin: Vec2): void {
		const scatter = this.manager.sceneSystem.objects.worldTreeScatter;

		scatter.sync(this.renderer, this.manager.sceneSystem.objects.tiles);

		if (scatter.clusters.size === 0) {
			return;
		}

		const camera = this.manager.sceneSystem.objects.camera;

		scatter.position.set(instancesOrigin.x, 0, instancesOrigin.y);
		scatter.updateMatrix();
		scatter.updateMatrixWorld();

		const mvMatrixPrev = Mat4.multiply(this.cameraMatrixWorldInversePrev, scatter.matrixWorld);
		const modelMatrix = new Float32Array(scatter.matrixWorld.values);
		const projMatrix = new Float32Array(camera.jitteredProjectionMatrix.values);
		const viewMatrix = new Float32Array(camera.matrixWorldInverse.values);
		const mvPrev = new Float32Array(mvMatrixPrev.values);

		const drawWith = (material: AbstractMaterial, mesh: AbstractMesh, treeMatrix: Float32Array): void => {
			this.renderer.useMaterial(material);
			material.getUniform('projectionMatrix', 'MainBlock').value = projMatrix;
			material.getUniform('modelMatrix', 'MainBlock').value = modelMatrix;
			material.getUniform('viewMatrix', 'MainBlock').value = viewMatrix;
			material.getUniform('modelViewMatrixPrev', 'MainBlock').value = mvPrev;
			material.getUniform('carMatrix', 'MainBlock').value = treeMatrix;
			material.getUniform('carMatrixPrev', 'MainBlock').value = treeMatrix;
			material.updateUniformBlock('MainBlock');
			mesh.draw();
		};

		for (const cluster of scatter.clusters.values()) {
			if (cluster.species.length === 0) {
				continue;
			}

			const m = Mat4.translate(Mat4.identity(),
				cluster.anchor[0] - instancesOrigin.x, 0, cluster.anchor[1] - instancesOrigin.y);
			const treeMatrix = new Float32Array(m.values);

			for (const s of cluster.species) {
				if (s.barkMesh) drawWith(this.treeModelMaterial(s.bark), s.barkMesh, treeMatrix);
				if (s.leafMesh && s.leaf) drawWith(this.treeModelMaterial(s.leaf), s.leafMesh, treeMatrix);
			}
		}
	}

	// Strata Lane B (s13) — draw the HAND-PLACED test buildings (KeyU). For each placed instance,
	// compute the placement transform from its footprint OMBB + the chosen building's source dims
	// (buildingPlacement), then draw each facade part with its own texture. Same precision pivot as
	// renderWorldTreeScatter: one shared modelMatrix at the origin, a per-instance carMatrix carrying
	// translate(anchor - origin) · yRotate(yaw) · scale. Static → carMatrixPrev == carMatrix.
	private renderPlacedBuildings(instancesOrigin: Vec2): void {
		if (!placedBuildingsState.enabled || placedBuildingsState.instances.length === 0) {
			return;
		}

		const obj = this.manager.sceneSystem.objects.placedBuildings;
		const set = obj.getBuilding(this.renderer, placedBuildingsState.buildingIndex);
		if (!set) {
			return;
		}

		const camera = this.manager.sceneSystem.objects.camera;
		obj.position.set(instancesOrigin.x, 0, instancesOrigin.y);
		obj.updateMatrix();
		obj.updateMatrixWorld();

		const mvMatrixPrev = Mat4.multiply(this.cameraMatrixWorldInversePrev, obj.matrixWorld);
		const modelMatrix = new Float32Array(obj.matrixWorld.values);
		const projMatrix = new Float32Array(camera.jitteredProjectionMatrix.values);
		const viewMatrix = new Float32Array(camera.matrixWorldInverse.values);
		const mvPrev = new Float32Array(mvMatrixPrev.values);

		for (const inst of placedBuildingsState.instances) {
			const p = computeBuildingPlacement(inst.rect, inst.targetHeight, set.dims, inst.groundY);

			// translate(anchor - origin) · yRotate(yaw) · scale, on the origin-centered (recentered) mesh.
			let m = Mat4.translate(Mat4.identity(),
				p.anchorX - instancesOrigin.x, p.anchorY, p.anchorZ - instancesOrigin.y);
			m = Mat4.yRotate(m, p.yaw);
			m = Mat4.scale(m, p.scaleX, p.scaleY, p.scaleZ);
			const buildingMatrix = new Float32Array(m.values);

			for (const part of set.parts) {
				const image = obj.images.get(part.textureKey);
				if (!image) {
					continue;
				}
				const material = this.buildingMaterial(part.textureKey, image);
				this.renderer.useMaterial(material);
				material.getUniform('projectionMatrix', 'MainBlock').value = projMatrix;
				material.getUniform('modelMatrix', 'MainBlock').value = modelMatrix;
				material.getUniform('viewMatrix', 'MainBlock').value = viewMatrix;
				material.getUniform('modelViewMatrixPrev', 'MainBlock').value = mvPrev;
				material.getUniform('carMatrix', 'MainBlock').value = buildingMatrix;
				material.getUniform('carMatrixPrev', 'MainBlock').value = buildingMatrix;
				material.updateUniformBlock('MainBlock');
				part.mesh.draw();
			}
		}
	}

	// Strata Lane B (s13) — draw the PROCEDURAL model-building city (KeyU). Same precision pivot as the
	// tree scatter: one shared modelMatrix at the origin, per-tile carMatrix = translate(tileAnchor -
	// origin). Each tile holds one merged mesh per facade texture; static → carMatrixPrev == carMatrix.
	private renderModelBuildingScatter(instancesOrigin: Vec2): void {
		const scatter = this.manager.sceneSystem.objects.modelBuildingScatter;
		scatter.sync(this.renderer, this.manager.sceneSystem.objects.tiles);

		if (scatter.clusters.size === 0) {
			return;
		}

		const camera = this.manager.sceneSystem.objects.camera;
		scatter.position.set(instancesOrigin.x, 0, instancesOrigin.y);
		scatter.updateMatrix();
		scatter.updateMatrixWorld();

		const mvMatrixPrev = Mat4.multiply(this.cameraMatrixWorldInversePrev, scatter.matrixWorld);
		const modelMatrix = new Float32Array(scatter.matrixWorld.values);
		const projMatrix = new Float32Array(camera.jitteredProjectionMatrix.values);
		const viewMatrix = new Float32Array(camera.matrixWorldInverse.values);
		const mvPrev = new Float32Array(mvMatrixPrev.values);

		for (const cluster of scatter.clusters.values()) {
			if (cluster.parts.length === 0) {
				continue;
			}
			const m = Mat4.translate(Mat4.identity(),
				cluster.anchor[0] - instancesOrigin.x, 0, cluster.anchor[1] - instancesOrigin.y);
			const tileMatrix = new Float32Array(m.values);

			for (const part of cluster.parts) {
				const image = scatter.images.get(part.textureKey);
				if (!image) {
					continue;
				}
				const material = this.buildingMaterial(part.textureKey, image);
				this.renderer.useMaterial(material);
				material.getUniform('projectionMatrix', 'MainBlock').value = projMatrix;
				material.getUniform('modelMatrix', 'MainBlock').value = modelMatrix;
				material.getUniform('viewMatrix', 'MainBlock').value = viewMatrix;
				material.getUniform('modelViewMatrixPrev', 'MainBlock').value = mvPrev;
				material.getUniform('carMatrix', 'MainBlock').value = tileMatrix;
				material.getUniform('carMatrixPrev', 'MainBlock').value = tileMatrix;
				material.updateUniformBlock('MainBlock');
				part.mesh.draw();
			}
		}
	}

	// Transform the model's local tower-leg footprints into WORLD space by the SAME placement the
	// renderer uses (translate(anchor + offset) · yaw · scale, minus the origin-relative shift, since
	// collision works in absolute coords) and register them height-gated at the deck level, so they
	// track the live placement sliders. Clears them when the model is off / not loaded.
	private syncBridgeModelFootprints(corridor: BridgeCorridor | undefined, model: BridgeModelObject): void {
		if (!corridor || !corridor.modelEnabled || !corridor.modelAnchor || model.legFootprints.length === 0) {
			buildingCollisionRegistry.setModelFootprints([]);
			return;
		}

		const scale = corridor.modelScale ?? 1;
		const stretch = corridor.modelStretch ?? 1;
		const yaw = corridor.modelYaw ?? 0;
		const [ax, az] = corridor.modelAnchor;

		let m = Mat4.identity();
		m = Mat4.translate(m, ax + (corridor.modelOffsetX ?? 0), corridor.modelOffsetY ?? 0, az + (corridor.modelOffsetZ ?? 0));
		m = Mat4.yRotate(m, yaw);
		m = Mat4.scale(m, scale * stretch, scale, scale);

		const yMin = (corridor.deckHeight ?? 0) - BridgeTowerCollisionYBand;

		const entries: ModelFootprint[] = model.legFootprints.map(poly => {
			const world = poly.map(p => {
				const v = Vec3.applyMatrix4(new Vec3(p.x, 0, p.z), m);
				return {x: v.x, z: v.z};
			});
			return {polygon: world, aabb: polygonAABB(world), yMin};
		});

		buildingCollisionRegistry.setModelFootprints(entries);
	}

	private writeToObjectIdBuffer(): void {
		const mainRenderPass = this.getPhysicalResource('GBufferRenderPass');
		mainRenderPass.readColorAttachmentPixel(4, this.objectIdBuffer, this.objectIdX, this.objectIdY);
	}

	private getInstancesOrigin(camera: Camera): Vec2 {
		return new Vec2(
			Math.floor(camera.position.x / 10000) * 10000,
			Math.floor(camera.position.z / 10000) * 10000
		);
	}

	public render(): void {
		const camera = this.manager.sceneSystem.objects.camera;

		const instancesOrigin = this.getInstancesOrigin(camera);

		if (!this.cameraMatrixWorldInversePrev) {
			this.cameraMatrixWorldInversePrev = camera.matrixWorldInverse;
		} else {
			const pivotDelta = this.manager.sceneSystem.pivotDelta;

			this.cameraMatrixWorldInversePrev = Mat4.translate(
				this.cameraMatrixWorldInversePrev,
				pivotDelta.x,
				0,
				pivotDelta.y
			);
		}

		this.updateMaterialsDefines();

		const mainRenderPass = this.getPhysicalResource('GBufferRenderPass');
		this.renderer.beginRenderPass(mainRenderPass);

		this.renderSkybox();
		this.renderExtrudedMeshes();
		this.renderAircraft(instancesOrigin);
		this.renderTerrain();
		this.renderProjectedMeshes();
		this.renderHuggingMeshes();
		this.renderInstances(instancesOrigin);
		this.renderDeck(instancesOrigin);
		this.renderBridgeModel(instancesOrigin);
		this.renderWorldTreeScatter(instancesOrigin);
		this.renderModelBuildingScatter(instancesOrigin);
		this.renderCollisionDebug(instancesOrigin);
		this.renderCar(instancesOrigin);
		this.writeToObjectIdBuffer();

		this.saveCameraMatrixWorldInverse();
	}

	private saveCameraMatrixWorldInverse(): void {
		this.cameraMatrixWorldInversePrev = this.manager.sceneSystem.objects.camera.matrixWorldInverse;
	}

	public setSize(width: number, height: number): void {

	}
}