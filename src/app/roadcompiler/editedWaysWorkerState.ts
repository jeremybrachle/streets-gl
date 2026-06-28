// Road-compiler (Checkpoint ③ step 3, ghost suppression — roadmap §0.5 "Step 3 acceptance criterion",
// approach A). A general bridge-tagged way is drawn as a FLAT GROUND DECAL by VectorPolylineHandler;
// the moment the editor lifts its ribbon to an edited height, that flat decal would stay painted on the
// terrain as a ghost road under the raised section. The edit overlay lives main-thread (the worker
// can't read localStorage), so the main thread pushes the set of edited way ids INTO each tile worker
// (WorkerMessage.SetEditedWays). This module is that worker-side mutable set: WorkerInstance writes it,
// VectorPolylineHandler.handlePath reads it to suppress the flat draped roadway for exactly those ways.
//
// It is a plain module singleton, mirroring how Config is a shared singleton read in the worker. Each
// tile worker is its own thread / module instance, so the main thread broadcasts the set to ALL workers;
// within one worker, WorkerInstance and the handler share this one instance. On the main thread the
// module is loaded but never written (handlers don't run there), so it is inert.
//
// Generic + portable: it only knows OSM way ids — no SF/Bay/GGB furniture.

const editedWayIds = new Set<number>();

/** Replace the worker's set of height-edited way ids (called on every SetEditedWays message). */
export function setEditedWayIds(ids: Iterable<number>): void {
	editedWayIds.clear();
	for (const id of ids) {
		editedWayIds.add(id);
	}
}

/** True if this way's flat draped roadway should be suppressed at decode (its height is being edited). */
export function isWayHeightEdited(wayId: number | null | undefined): boolean {
	return wayId != null && editedWayIds.has(wayId);
}
