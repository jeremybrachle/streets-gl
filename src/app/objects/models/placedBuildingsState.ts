import {OMBBRect} from "./buildingPlacement";

// Strata Lane B (s13) — BUILDINGS, increment B2: a tiny gate + store for HAND-PLACED test buildings,
// mirroring worldTreeScatterState. DriveControlsNavigator drops a building in front of the car (KeyU);
// GBufferPass.renderPlacedBuildings reads `instances` each frame, computes the placement matrix
// (buildingPlacement.computeBuildingPlacement), and draws the chosen building with its facade
// textures. Default OFF / empty. This is the throwaway-friendly probe step: prove the footprint→model
// path on one building before wiring REAL OSM footprints (B3) + a tag→model matcher (later).

export interface PlacedInstance {
	/** Target footprint as an oriented rectangle (world XZ). */
	rect: OMBBRect;
	/** Target building height in meters. */
	targetHeight: number;
	/** Terrain height at the footprint center (building base sits here). */
	groundY: number;
}

class PlacedBuildingsState {
	public enabled = false;
	public instances: PlacedInstance[] = [];
	/** Index into the extracted building list to place (cycled with the place key for A/B). */
	public buildingIndex = 0;

	/**
	 * Toggle: if a test building is placed, clear it; otherwise drop one a fixed offset from the car so
	 * it's immediately visible (orientation/offset are first-guess knobs — B3 uses real footprints).
	 */
	public toggleAt(carX: number, carZ: number, groundY: number): void {
		if (this.instances.length > 0) {
			this.instances = [];
			this.enabled = false;
			return;
		}

		// 40 m to the side of the car, long side along +X. A 30 (long) × 18 (short) footprint, 60 m tall.
		const centerX = carX + 40;
		const centerZ = carZ + 40;
		this.instances.push({
			rect: {centerX, centerZ, longLen: 30, shortLen: 18, longDirX: 1, longDirZ: 0},
			targetHeight: 60,
			groundY
		});
		this.enabled = true;
	}
}

export const placedBuildingsState = new PlacedBuildingsState();
