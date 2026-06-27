import RenderableObject3D from "./RenderableObject3D";
import AbstractMesh from "~/lib/renderer/abstract-renderer/AbstractMesh";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import Vec3 from "~/lib/math/Vec3";
import {buildingCollisionRegistry} from "~/app/collision/BuildingCollisionRegistry";

// Strata physics spike — the VISIBLE building-collision overlay. A RenderableObject3D whose mesh is
// a flat red decal of every nearby building's convex footprint (the exact polygon the car is pushed
// out of), laid on the terrain so the user can SEE how far the collision boundary reaches vs the
// drawn building. Toggled by buildingCollisionRegistry.showDebug; (re)built by
// GBufferPass.renderCollisionDebug (which owns the terrain height provider), like DeckRibbon.
//
// Perf: this is a debug toggle, so it's built only for footprints NEAR the car and rebuilt only when
// something actually changed (the footprint set, or the car drifted far) AND no more often than the
// throttle — never per-frame (an unbounded per-frame rebuild + GPU realloc tanks the frame rate).
const DebugLift = 0.4;            // m above the ground so the decal doesn't z-fight the terrain
const DebugColor = [235, 45, 45]; // red
const CullRadius = 450;           // m around the car to draw footprints for
const RebuildMoveDist = 120;      // m the car may drift before we rebuild the near set
const ThrottleMs = 300;           // min interval between rebuilds

export default class CollisionDebugMesh extends RenderableObject3D {
	public mesh: AbstractMesh = null;

	// Precision pivot: vertices are baked relative to this world (x, z); the renderer finishes the
	// origin shift with a translate matrix.
	public anchor: [number, number] = [0, 0];

	private builtRevision = -1;
	private lastBuildMs = -Infinity;
	private lastCenterX = Infinity;
	private lastCenterZ = Infinity;

	public constructor() {
		super();
		this.setBoundingBox(new Vec3(-1e6, -1e6, -1e6), new Vec3(1e6, 1e6, 1e6));
	}

	public isMeshReady(): boolean {
		return this.mesh !== null;
	}

	public updateMesh(): void {}

	/**
	 * Rebuild the near-car overlay if needed (set changed / car moved far) and the throttle allows.
	 * Cheap no-op on most frames. `centerX/Z` = the car (camera) position.
	 */
	public maybeRebuild(
		renderer: AbstractRenderer,
		groundAt: (x: number, z: number) => number | null,
		centerX: number,
		centerZ: number
	): void {
		const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
		const movedFar =
			(centerX - this.lastCenterX) ** 2 + (centerZ - this.lastCenterZ) ** 2 > RebuildMoveDist * RebuildMoveDist;
		const changed = this.mesh === null || this.builtRevision !== buildingCollisionRegistry.revision || movedFar;

		if (!changed || now - this.lastBuildMs < ThrottleMs) {
			return;
		}

		this.rebuild(renderer, groundAt, centerX, centerZ);
		this.lastBuildMs = now;
		this.lastCenterX = centerX;
		this.lastCenterZ = centerZ;
		this.builtRevision = buildingCollisionRegistry.revision;
	}

	private rebuild(
		renderer: AbstractRenderer,
		groundAt: (x: number, z: number) => number | null,
		centerX: number,
		centerZ: number
	): void {
		const polygons = buildingCollisionRegistry.visiblePolygonsNear(centerX, centerZ, CullRadius);

		if (this.mesh) {
			this.mesh.delete();
			this.mesh = null;
		}

		if (polygons.length === 0) {
			this.anchor = [0, 0];
			return;
		}

		this.anchor = [polygons[0][0].x, polygons[0][0].z];

		const position: number[] = [];
		const normal: number[] = [];
		const color: number[] = [];

		for (const poly of polygons) {
			if (poly.length < 3) {
				continue;
			}

			// Sample the DEM at each vertex; skip the whole polygon if a tile isn't loaded yet (it
			// reappears on the next rebuild once the tile streams in and bumps the registry revision).
			const ys: number[] = [];
			let ok = true;
			for (const p of poly) {
				const g = groundAt(p.x, p.z);
				if (g === null) {
					ok = false;
					break;
				}
				ys.push(g + DebugLift);
			}
			if (!ok) {
				continue;
			}

			for (let i = 1; i < poly.length - 1; i++) {
				for (const k of [0, i, i + 1]) {
					position.push(poly[k].x - this.anchor[0], ys[k], poly[k].z - this.anchor[1]);
					normal.push(0, 1, 0);
					color.push(DebugColor[0], DebugColor[1], DebugColor[2]);
				}
			}
		}

		if (position.length === 0) {
			return;
		}

		this.mesh = renderer.createMesh({
			attributes: [
				renderer.createAttribute({
					name: 'position', size: 3,
					type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float,
					normalized: false, buffer: renderer.createAttributeBuffer({data: new Float32Array(position)})
				}),
				renderer.createAttribute({
					name: 'normal', size: 3,
					type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float,
					normalized: false, buffer: renderer.createAttributeBuffer({data: new Float32Array(normal)})
				}),
				renderer.createAttribute({
					name: 'color', size: 3,
					type: RendererTypes.AttributeType.UnsignedByte, format: RendererTypes.AttributeFormat.Float,
					normalized: true, buffer: renderer.createAttributeBuffer({data: new Uint8Array(color)})
				})
			]
		});
	}
}
