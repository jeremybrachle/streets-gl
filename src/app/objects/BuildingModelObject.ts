import RenderableObject3D from "./RenderableObject3D";
import AbstractMesh from "~/lib/renderer/abstract-renderer/AbstractMesh";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import Vec3 from "~/lib/math/Vec3";
import {extractBuildingsFromGLB, BuildedBuilding} from "~/app/objects/models/buildingModel";
import {SourceDims} from "~/app/objects/models/buildingPlacement";

// Strata Lane B (s13) — BUILDINGS, increment B2: the downtown building kit as a RenderableObject3D
// (mirrors BridgeModelObject). Lazily extracts all named buildings from the loaded GLB, then builds
// GPU meshes per building ON DEMAND (cached by index — placing one building doesn't upload all 18).
// Facade images come straight from the GLB; GBufferPass turns each textureKey into a material. Best-
// effort: a failed extract leaves it empty and nothing draws — drive is never blocked.

export interface BuildingPartMesh {
	mesh: AbstractMesh;
	textureKey: string;
}

export interface BuildingMeshSet {
	parts: BuildingPartMesh[];
	dims: SourceDims;
}

export default class BuildingModelObject extends RenderableObject3D {
	// No single mesh — buildings are built lazily per index in getBuilding() at draw time. mesh stays
	// null and isMeshReady() is true so the scene's updateMesh traversal never touches this object.
	public mesh: AbstractMesh = null;
	public tried = false;
	public buildings: BuildedBuilding[] = [];
	/** textureKey → decoded GLB image, for GBufferPass to upload one material per key. */
	public images: Map<string, any> = new Map();
	private meshCache: Map<number, BuildingMeshSet> = new Map();

	public constructor() {
		super();
		this.setBoundingBox(new Vec3(-1e6, -1e6, -1e6), new Vec3(1e6, 1e6, 1e6));
	}

	public isMeshReady(): boolean {
		return true; // building meshes are built on demand in getBuilding(), not via the scene traversal
	}

	public updateMesh(_renderer: AbstractRenderer): void {
		// no-op — see getBuilding()
	}

	private ensureExtracted(): void {
		if (this.tried) {
			return;
		}
		this.tried = true;
		try {
			const {buildings, images} = extractBuildingsFromGLB('downtownBuildings');
			this.buildings = buildings;
			this.images = images;
			console.log(`[Strata] downtown buildings extracted: ${buildings.length}`, buildings.map(b => b.name));
		} catch (e) {
			console.warn('[Strata] extractBuildingsFromGLB failed, no building models:', e);
		}
	}

	/** Build (and cache) the GPU meshes for one building by index. Returns null if unavailable. */
	public getBuilding(renderer: AbstractRenderer, index: number): BuildingMeshSet | null {
		this.ensureExtracted();
		if (this.buildings.length === 0) {
			return null;
		}
		const i = ((index % this.buildings.length) + this.buildings.length) % this.buildings.length;

		const cached = this.meshCache.get(i);
		if (cached) {
			return cached;
		}

		const b = this.buildings[i];
		const parts: BuildingPartMesh[] = b.parts.map(part => ({
			textureKey: part.textureKey,
			mesh: renderer.createMesh({
				indexed: true,
				indices: part.indices,
				attributes: [
					renderer.createAttribute({
						name: 'position', size: 3,
						type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float,
						normalized: false, buffer: renderer.createAttributeBuffer({data: part.position})
					}),
					renderer.createAttribute({
						name: 'normal', size: 3,
						type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float,
						normalized: false, buffer: renderer.createAttributeBuffer({data: part.normal})
					}),
					renderer.createAttribute({
						name: 'uv', size: 2,
						type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float,
						normalized: false, buffer: renderer.createAttributeBuffer({data: part.uv})
					})
				]
			})
		}));

		const set: BuildingMeshSet = {parts, dims: b.dims};
		this.meshCache.set(i, set);
		return set;
	}
}
