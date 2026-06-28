import RenderableObject3D from "./RenderableObject3D";
import AbstractMesh from "~/lib/renderer/abstract-renderer/AbstractMesh";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import Vec3 from "~/lib/math/Vec3";
import {editableRoadRegistry, stitchCenterlines} from "~/app/roadcompiler/EditableRoadRegistry";
import {roadHeightEditRegistry} from "~/app/roadcompiler/RoadHeightEditRegistry";
import {BridgeCorridor, deckHeightFromS} from "~/app/bridge/BridgeDeck";

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

// Step 3 — when the selected way has a height edit, its ribbon is lifted to that height with smooth,
// grade-limited ramps down to terrain at the way's two ends (reusing deckHeightAt's flat-span-plus-
// ramp profile — the "auto-stretching ascent/descent"). These shape that ramp; the editor sets only
// the height, the ramps emerge.
const EditRampLength = 60;       // m: desired ramp blend length at each end (auto-extends to honor grade)
const EditMaxGrade = 0.08;       // max |rise/run| on the ramps

export default class SelectionRibbonMesh extends RenderableObject3D {
	public mesh: AbstractMesh = null;

	// Precision pivot: vertices are baked relative to this world (x, z); the renderer finishes the shift.
	public anchor: [number, number] = [0, 0];

	// The way + registry revision the current mesh was built for; -1 forces a first build.
	private builtRevision = -1;
	private builtWayId: number | null = null;
	// The height-edit registry revision the mesh was built for, so setting/changing the edited height
	// (which lives in a separate registry) rebuilds the ribbon at the new lifted profile.
	private builtHeightRevision = -1;
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
			this.builtHeightRevision !== roadHeightEditRegistry.revision ||
			!this.complete;

		if (!changed) {
			return;
		}

		this.rebuild(renderer, groundAt);
		this.builtRevision = editableRoadRegistry.revision;
		this.builtWayId = editableRoadRegistry.selectedWayId;
		this.builtHeightRevision = roadHeightEditRegistry.revision;
	}

	private rebuild(renderer: AbstractRenderer, groundAt: (x: number, z: number) => number | null): void {
		if (this.mesh) {
			this.mesh.delete();
			this.mesh = null;
		}

		const wayId = editableRoadRegistry.selectedWayId;
		const segments = editableRoadRegistry.selectedCenterlines();

		if (wayId === null || segments.length === 0) {
			this.complete = true; // nothing selected — nothing to wait on
			return;
		}

		// Stitch the way's per-tile segments into ORDERED CONNECTED PIECES. A clean way is one piece;
		// genuinely disjoint runs stay separate (no spurious span bridging a gap = no fold). Each piece is
		// lifted independently so its ramps land at THAT piece's two real ends, never at a tile seam.
		const pieces = stitchCenterlines(segments.map(s => s.centerline)).filter(p => p.length >= 2);
		if (pieces.length === 0) {
			this.complete = true;
			return;
		}

		this.anchor = [pieces[0][0][0], pieces[0][0][1]];

		// If the way has a height edit, lift each piece to that height via the shared deck-height law
		// (flat span + grade-limited ramps down to terrain at the ends); otherwise lay it flat just over
		// the terrain like the plain selection highlight.
		const editedHeight = roadHeightEditRegistry.heightFor(wayId);

		const position: number[] = [];
		const normal: number[] = [];
		const color: number[] = [];
		let complete = true;

		for (const line of pieces) {
			// Walk the piece by CUMULATIVE arc-length and evaluate the height law at that s directly — no
			// per-vertex re-projection (which, where a path nears itself, assigns a non-monotonic s and
			// folds the ribbon). totalLength is this piece's length, so the ramps land at its two ends.
			const ss: number[] = new Array(line.length);
			ss[0] = 0;
			for (let i = 1; i < line.length; i++) {
				ss[i] = ss[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
			}
			const totalLength = ss[line.length - 1];

			const corridor: BridgeCorridor | null = editedHeight === null ? null : {
				centerline: line,
				halfWidth: RibbonHalfWidth,
				deckHeight: editedHeight,
				rampLength: EditRampLength,
				maxGrade: EditMaxGrade,
			};

			// Per-vertex height. For an edited piece the ramps blend down to terrain at its ends; where
			// terrain hasn't streamed in yet, hold at the edited height (or carry the last good height for
			// the flat highlight) and mark incomplete so it rebuilds once the tile loads.
			const ys: number[] = new Array(line.length);
			let lastGood = editedHeight ?? 0;
			for (let i = 0; i < line.length; i++) {
				const [x, z] = line[i];
				const g = groundAt(x, z);
				if (g === null) {
					complete = false;
				} else {
					lastGood = g;
				}

				if (corridor) {
					const ground = g ?? corridor.deckHeight;
					ys[i] = deckHeightFromS(corridor, ss[i], totalLength, ground) ?? ground;
				} else {
					ys[i] = (g ?? lastGood) + RibbonLift;
				}
			}

			// Offset each vertex laterally by ±halfWidth (perpendicular to the local tangent) into a
			// two-sided ribbon, then emit two triangles per segment.
			const left: [number, number][] = [];
			const right: [number, number][] = [];
			for (let i = 0; i < line.length; i++) {
				const prev = line[Math.max(0, i - 1)];
				const next = line[Math.min(line.length - 1, i + 1)];
				let tx = next[0] - prev[0];
				let tz = next[1] - prev[1];
				const len = Math.hypot(tx, tz) || 1;
				tx /= len;
				tz /= len;
				// Perpendicular in the [x, z] plane.
				const px = -tz;
				const pz = tx;
				const [cx, cz] = line[i];
				left.push([cx + px * RibbonHalfWidth, cz + pz * RibbonHalfWidth]);
				right.push([cx - px * RibbonHalfWidth, cz - pz * RibbonHalfWidth]);
			}

			for (let i = 0; i < line.length - 1; i++) {
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
