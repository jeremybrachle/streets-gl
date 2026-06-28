// Road-compiler (Checkpoint ③ step 3 — roadmap §0.5 "Step 3"). The main-thread live store of road
// HEIGHT edits, mirroring `bridgeRegistry`: a plain singleton the panel writes (set a height) and the
// selection ribbon reads each frame (lift to that height). Keyed by OSM way id → a `RoadHeightEdit`
// record (the canonical, graph-native, consumer-agnostic overlay from RoadHeightEdit.ts — the SAME
// schema the Print/export button and the future solver auto-fill use, so manual edits and automation
// share one format).
//
// MVP (step 3): ONE height per way — a single control point at the way's midpoint, vertical class +1
// (elevated). Step 4 grows it to N control-point handles; that is the same record with more points, no
// schema change. Persistence (localStorage) + Print/export is step 5; this registry is "localStorage
// ready" (it holds full RoadHeightEdit records) but does not persist yet.
//
// Ghost suppression (the step-3 acceptance criterion): when a way FIRST becomes edited (or stops being
// edited), its flat draped roadway must be suppressed at decode so it doesn't ghost under the lifted
// ribbon. That requires pushing the edited-way set to the tile workers + re-decoding affected tiles —
// engine work this consumer-agnostic registry must not do itself. So it exposes a plain `onEditedWays
// Changed` hook a system installs; the hook fires only when SET MEMBERSHIP changes (a way added/removed),
// NOT on every height tweak, so dragging a value never triggers a re-decode storm.

import {RoadHeightEdit, RoadHeightControlPoint} from "./RoadHeightEdit";

export class RoadHeightEditRegistry {
	private readonly edits = new Map<number, RoadHeightEdit>();

	/** Bumped on every height change so the selection ribbon (and the panel) rebuild/react. */
	public revision = 0;

	/**
	 * Installed by a system (TileSystem): called when the SET of edited ways changes — a way newly
	 * gained or lost a height edit — so the system can push the new set to the tile workers and
	 * re-decode the affected tiles (suppress the flat ghost). NOT called on a plain value change.
	 */
	public onEditedWaysChanged: ((editedWayIds: number[], changedWayId: number) => void) | null = null;

	/** Set the way's (single, MVP) height. New way → membership change (suppress its ghost decal). */
	public setHeight(osmWayId: number, z: number): void {
		const isNew = !this.edits.has(osmWayId);
		const point: RoadHeightControlPoint = {fractionAlong: 0.5, z, verticalClass: 1};
		this.edits.set(osmWayId, {osmWayId, points: [point]});
		this.revision++;

		if (isNew) {
			this.notifyMembershipChanged(osmWayId);
		}
	}

	/** Drop the way's height edit (back to terrain). Membership change → un-suppress its decal. */
	public clearHeight(osmWayId: number): void {
		if (this.edits.delete(osmWayId)) {
			this.revision++;
			this.notifyMembershipChanged(osmWayId);
		}
	}

	/** The way's edited height, or null if it has no edit (drive/draw on terrain). */
	public heightFor(osmWayId: number): number | null {
		const edit = this.edits.get(osmWayId);
		return edit && edit.points.length > 0 ? edit.points[0].z : null;
	}

	/** True if this way currently has a height edit. */
	public isEdited(osmWayId: number): boolean {
		return this.edits.has(osmWayId);
	}

	/** All currently-edited way ids (the set pushed to the tile workers). */
	public editedWayIds(): number[] {
		return [...this.edits.keys()];
	}

	/** The full overlay records (for the Print/export button — step 5). */
	public allEdits(): RoadHeightEdit[] {
		return [...this.edits.values()];
	}

	public clear(): void {
		this.edits.clear();
		this.revision++;
	}

	private notifyMembershipChanged(changedWayId: number): void {
		this.onEditedWaysChanged?.(this.editedWayIds(), changedWayId);
	}
}

/** The shared main-thread instance (mirrors `bridgeRegistry` / `editableRoadRegistry`). */
export const roadHeightEditRegistry = new RoadHeightEditRegistry();
