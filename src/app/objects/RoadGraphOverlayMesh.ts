import RenderableObject3D from "./RenderableObject3D";
import AbstractMesh from "~/lib/renderer/abstract-renderer/AbstractMesh";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import Vec3 from "~/lib/math/Vec3";
import {roadGraphOverlay} from "~/app/roadcompiler/RoadGraphOverlayRegistry";

// Strata P2 — the road-graph VISUAL ALIGNMENT GATE. A thin-line overlay of the clean OSM road graph
// (RoadGraphOverlayRegistry) laid just above the streets-gl roads, so you can eyeball that the continuous
// graph lines sit on the painted roads 1:1. Toggled by a keystroke; gated behind Config.RoadGraphOverlay.
//
// The renderer is triangle-only (no line primitive), so each road segment is drawn as a thin flat ribbon
// (reusing the car vertex-colour material, exactly like SelectionRibbonMesh) — the proven render path.
// Geometry is built ONCE per loaded city and re-draped only when the camera travels far enough that new
// terrain has streamed in; a segment is emitted only where terrain is loaded at BOTH ends, so the overlay
// always sits on the ground (never floats over un-streamed areas) in flyover AND while driving.
//
// Generic: it draws whatever city roadGraphOverlay loaded — no SF/Bay/GGB furniture, no hardcoded ids.
const OverlayLift = 1.5;          // m above the terrain so the line reads clearly over the draped road
const OverlayHalfWidth = 1.2;     // m to each side of the centerline — a thin but visible line
const OverlayColor = [80, 230, 255]; // bright neon blue — distinct from the green selection ribbon
// Re-drape when the camera has travelled this far since the last build (so far roads that were over
// un-streamed terrain get drawn once you approach them). Large enough to avoid frequent full rebuilds.
const RebuildMoveThreshold = 500; // m

export default class RoadGraphOverlayMesh extends RenderableObject3D {
	public mesh: AbstractMesh = null;

	// Precision pivot: vertices are baked relative to this world (x, z); the renderer finishes the shift.
	public anchor: [number, number] = [0, 0];

	// The overlay revision (loaded city) the current mesh was built for; -1 forces a first build.
	private builtRevision = -1;
	// Whether the last build happened while visible — so toggling on rebuilds even at the same revision.
	private builtVisible = false;
	// Camera position the mesh was last draped against, to decide when to re-drape.
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

	/** (Re)build the overlay when the loaded city changed, it was just toggled on, or the camera has
	 *  travelled far enough to warrant re-draping. Cheap no-op otherwise. */
	public maybeRebuild(
		renderer: AbstractRenderer,
		groundAt: (x: number, z: number) => number | null,
		camX: number,
		camZ: number
	): void {
		if (!roadGraphOverlay.visible || !roadGraphOverlay.ready) {
			// Hidden (or nothing loaded yet) — drop any geometry so it stops drawing.
			if (this.mesh) {
				this.mesh.delete();
				this.mesh = null;
			}
			this.builtVisible = false;
			return;
		}

		const moved = Math.hypot(camX - this.builtCamX, camZ - this.builtCamZ) > RebuildMoveThreshold;
		const changed = this.builtRevision !== roadGraphOverlay.revision || !this.builtVisible || moved;

		if (!changed) {
			return;
		}

		this.rebuild(renderer, groundAt, camX, camZ);
		this.builtRevision = roadGraphOverlay.revision;
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

		// Anchor at the camera so baked vertices stay small (precision); the model matrix shifts back.
		this.anchor = [camX, camZ];

		const position: number[] = [];
		const normal: number[] = [];
		const color: number[] = [];

		for (const way of roadGraphOverlay.frameEPolylines) {
			const pts = way.points;

			for (let i = 0; i < pts.length - 1; i++) {
				const [ax, az] = pts[i];
				const [bx, bz] = pts[i + 1];

				// Drape: only draw a segment whose terrain is loaded at both ends, so the line always sits
				// on the ground rather than floating over un-streamed tiles.
				const ya = groundAt(ax, az);
				const yb = groundAt(bx, bz);
				if (ya === null || yb === null) {
					continue;
				}

				// Perpendicular to the segment in the [x, z] plane, scaled to the ribbon half-width.
				let tx = bx - ax;
				let tz = bz - az;
				const len = Math.hypot(tx, tz) || 1;
				tx /= len;
				tz /= len;
				const px = -tz * OverlayHalfWidth;
				const pz = tx * OverlayHalfWidth;

				const yaL = ya + OverlayLift;
				const ybL = yb + OverlayLift;

				// Two triangles: (aL, aR, bR) and (aL, bR, bL), with vertices relative to the anchor.
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
					color.push(OverlayColor[0], OverlayColor[1], OverlayColor[2]);
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
