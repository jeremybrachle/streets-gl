import RenderableObject3D from "./RenderableObject3D";
import AbstractMesh from "~/lib/renderer/abstract-renderer/AbstractMesh";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import Vec3 from "~/lib/math/Vec3";
import {routeRegistry} from "~/app/roadcompiler/RouteRegistry";

// Strata GPS — the ACTIVE ROUTE drawn in the 3D world as a bright yellow ribbon draped over the roads,
// so you can see the chosen path in the real world. Sibling of RoadGraphOverlayMesh (same triangle-ribbon
// drape + car material), but it draws the ONE routeRegistry.routePolyline instead of the whole graph, in
// yellow, at a higher lift/width so it reads clearly ON TOP of the blue all-roads overlay. Toggled by KeyP
// (routeRegistry.visible) — independent of the KeyO overlay. Rebuilds when the route changes (revision) or
// the camera travels far enough to drape newly-streamed terrain.
const RouteLift = 2.6;          // m above terrain — above the blue overlay's 1.5 so the route sits on top
const RouteHalfWidth = 2.6;     // m each side — wider than the blue lines so the route stands out
const RouteColor = [255, 255, 0]; // neon yellow — distinct from the blue overlay + green selection ribbon
const RebuildMoveThreshold = 500; // m — re-drape after the camera has moved this far

export default class RouteOverlayMesh extends RenderableObject3D {
	public mesh: AbstractMesh = null;

	// Precision pivot: vertices are baked relative to this world (x, z); the renderer finishes the shift.
	public anchor: [number, number] = [0, 0];

	private builtRevision = -1;
	private builtVisible = false;
	private builtCamX = 0;
	private builtCamZ = 0;

	public constructor() {
		super();
		this.setBoundingBox(new Vec3(-1e6, -1e6, -1e6), new Vec3(1e6, 1e6, 1e6));
	}

	public isMeshReady(): boolean {
		return this.mesh !== null;
	}

	public updateMesh(): void {}

	/** (Re)build the route ribbon when the route changed, it was just toggled on, or the camera travelled
	 *  far enough to warrant re-draping. Cheap no-op otherwise. */
	public maybeRebuild(
		renderer: AbstractRenderer,
		groundAt: (x: number, z: number) => number | null,
		camX: number,
		camZ: number
	): void {
		if (!routeRegistry.visible || !routeRegistry.hasRoute) {
			if (this.mesh) {
				this.mesh.delete();
				this.mesh = null;
			}
			this.builtVisible = false;
			return;
		}

		const moved = Math.hypot(camX - this.builtCamX, camZ - this.builtCamZ) > RebuildMoveThreshold;
		const changed = this.builtRevision !== routeRegistry.revision || !this.builtVisible || moved;

		if (!changed) {
			return;
		}

		this.rebuild(renderer, groundAt, camX, camZ);
		this.builtRevision = routeRegistry.revision;
		this.builtVisible = true;
		this.builtCamX = camX;
		this.builtCamZ = camZ;
	}

	private rebuild(
		renderer: AbstractRenderer,
		groundAt: (x: number, z: number) => number | null,
		camX: number,
		camZ: number
	): void {
		if (this.mesh) {
			this.mesh.delete();
			this.mesh = null;
		}

		this.anchor = [camX, camZ];

		const position: number[] = [];
		const normal: number[] = [];
		const color: number[] = [];

		const pts = routeRegistry.routePolyline;
		for (let i = 0; i < pts.length - 1; i++) {
			const [ax, az] = pts[i];
			const [bx, bz] = pts[i + 1];

			// Drape: only draw a segment whose terrain is loaded at both ends (never floats over un-streamed
			// tiles). A far part of the route simply appears once you approach it (re-drape threshold).
			const ya = groundAt(ax, az);
			const yb = groundAt(bx, bz);
			if (ya === null || yb === null) {
				continue;
			}

			let tx = bx - ax;
			let tz = bz - az;
			const len = Math.hypot(tx, tz) || 1;
			tx /= len;
			tz /= len;
			const px = -tz * RouteHalfWidth;
			const pz = tx * RouteHalfWidth;

			const yaL = ya + RouteLift;
			const ybL = yb + RouteLift;

			const aLx = ax + px, aLz = az + pz;
			const aRx = ax - px, aRz = az - pz;
			const bLx = bx + px, bLz = bz + pz;
			const bRx = bx - px, bRz = bz - pz;

			const tri: [number, number, number][] = [
				[aLx, yaL, aLz], [aRx, yaL, aRz], [bRx, ybL, bRz],
				[aLx, yaL, aLz], [bRx, ybL, bRz], [bLx, ybL, bLz],
			];

			for (const [vx, vy, vz] of tri) {
				position.push(vx - this.anchor[0], vy, vz - this.anchor[1]);
				normal.push(0, 1, 0);
				color.push(RouteColor[0], RouteColor[1], RouteColor[2]);
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
