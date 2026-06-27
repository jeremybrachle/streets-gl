// Strata Lane B (s11) — tiny shared gate for the world-wide model-tree scatter, mirroring
// buildingCollisionRegistry's pattern. DriveControlsNavigator toggles `enabled` (KeyT); the
// WorldTreeScatter object reads it each frame. Default OFF for now: the model trees currently double
// up with the engine billboards (the new tree "grows inside" the old one) and cost perf, so they stay
// off until the rendering is reworked (instanced + LOD + billboard suppression). KeyT toggles them on
// for testing; the old hand-placed Presidio probe cluster has been removed entirely.
class WorldTreeScatterState {
	public enabled = false;
}

export const worldTreeScatterState = new WorldTreeScatterState();
