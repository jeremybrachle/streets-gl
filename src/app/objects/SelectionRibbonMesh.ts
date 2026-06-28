import RenderableObject3D from "./RenderableObject3D";
import AbstractMesh from "~/lib/renderer/abstract-renderer/AbstractMesh";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import Vec3 from "~/lib/math/Vec3";
import {editableRoadRegistry} from "~/app/roadcompiler/EditableRoadRegistry";

// Strata Checkpoint ③ (step 2b) — the VISIBLE selection highlight for the road-height editor. A
// RenderableObject3D whose mesh is a flat coloured ribbon laid along the selected road's centerline(s),
// so a click visibly selects a real road from the orbit camera. Built + drawn by
// GBufferPass.renderSelectionRibbon (which owns the terrain height provider), exactly like DeckRibbon /
// CollisionDebugMesh; reuses the car vertex-colour material.
//
// Portable + generic: it highlights whatever way is selected in editableRoadRegistry — no SF/Bay/GGB
// furniture. The ribbon is a fixed visible width (the registry carries only the centerline, not per-road
// width yet) drawn just above the terrain; later checkpoints lift it to the edited height.
const RibbonLift = 0.6;          // m above the ground so the highlight reads over the draped road
const RibbonHalfWidth = 6;       // m to each side of the centerline — a clearly visible band
const RibbonColor = [60, 235, 120]; // bright green

export default class SelectionRibbonMesh extends RenderableObject3D {
	public mesh: AbstractMesh = null;

	// Precision pivot: vertices are baked relative to this world (x, z); the renderer finishes the shift.
	public anchor: [number, number] = [0, 0];

	// The way + registry revision the current mesh was built for; -1 forces a first build.
	private builtRevision = -1;
	private builtWayId: number | null = null;
	// False while a vertex sampled the DEM before its tile loaded — keep rebuilding until terrain is real.
	private complete = false;

	public constructor() {
		super();
		this.setBoundingBox(new Vec3(-1e6, -1e6, -1e6), new Vec3(1e6, 1e6, 1e6));
	}

	public isMeshReady(): boolean {
		return this.mesh !== null;
	}

	public updateMesh(): void {}

	/** Rebuild the highlight when the selection (or terrain under it) changed. Cheap no-op otherwise. */
	public maybeRebuild(renderer: AbstractRenderer, groundAt: (x: number, z: number) => number | null): void {
		const changed =
			this.builtRevision !== editableRoadRegistry.revision ||
			this.builtWayId !== editableRoadRegistry.selectedWayId ||
			!this.complete;

		if (!changed) {
			return;
		}

		this.rebuild(renderer, groundAt);
		this.builtRevision = editableRoadRegistry.revision;
		this.builtWayId = editableRoadRegistry.selectedWayId;
	}

	private rebuild(renderer: AbstractRenderer, groundAt: (x: number, z: number) => number | null): void {
		if (this.mesh) {
			this.mesh.delete();
			this.mesh = null;
		}

		const centerlines = editableRoadRegistry.selectedCenterlines();

		if (centerlines.length === 0) {
			this.complete = true; // nothing selected — nothing to wait on
			return;
		}

		this.anchor = [centerlines[0].centerline[0][0], centerlines[0].centerline[0][1]];

		const position: number[] = [];
		const normal: number[] = [];
		const color: number[] = [];
		let complete = true;

		for (const {centerline} of centerlines) {
			if (centerline.length < 2) {
				continue;
			}

			// Sample the DEM at each centerline vertex; skip the whole segment if a tile isn't loaded yet
			// (it reappears once the tile streams in and bumps the registry revision).
			const ys: number[] = [];
			let ok = true;
			for (const [x, z] of centerline) {
				const g = groundAt(x, z);
				if (g === null) {
					ok = false;
					break;
				}
				ys.push(g + RibbonLift);
			}
			if (!ok) {
				complete = false;
				continue;
			}

			// Offset each vertex laterally by ±halfWidth (perpendicular to the local tangent) into a
			// two-sided ribbon, then emit two triangles per segment.
			const left: [number, number][] = [];
			const right: [number, number][] = [];
			for (let i = 0; i < centerline.length; i++) {
				const prev = centerline[Math.max(0, i - 1)];
				const next = centerline[Math.min(centerline.length - 1, i + 1)];
				let tx = next[0] - prev[0];
				let tz = next[1] - prev[1];
				const len = Math.hypot(tx, tz) || 1;
				tx /= len;
				tz /= len;
				// Perpendicular in the [x, z] plane.
				const px = -tz;
				const pz = tx;
				const [cx, cz] = centerline[i];
				left.push([cx + px * RibbonHalfWidth, cz + pz * RibbonHalfWidth]);
				right.push([cx - px * RibbonHalfWidth, cz - pz * RibbonHalfWidth]);
			}

			for (let i = 0; i < centerline.length - 1; i++) {
				const verts: [[number, number], number][] = [
					[left[i], ys[i]], [right[i], ys[i]], [right[i + 1], ys[i + 1]],
					[left[i], ys[i]], [right[i + 1], ys[i + 1]], [left[i + 1], ys[i + 1]],
				];
				for (const [[vx, vz], vy] of verts) {
					position.push(vx - this.anchor[0], vy, vz - this.anchor[1]);
					normal.push(0, 1, 0);
					color.push(RibbonColor[0], RibbonColor[1], RibbonColor[2]);
				}
			}
		}

		this.complete = complete;

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
