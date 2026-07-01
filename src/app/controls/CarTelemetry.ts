// Per-frame car telemetry (Strata minimap / HUD, s28). A tiny mutable singleton that DriveControlsNavigator
// publishes the car's frame-E pose into every tick, so UI components (the minimap, later the GPS/route HUD)
// can read the live car position + heading WITHOUT reaching into the controls system or churning Recoil at
// 60 fps. Mirrors the roadcompiler registry pattern (bridgeRegistry / editableRoadRegistry): read it in a
// requestAnimationFrame loop, no subscriptions.
//
// Coordinates are frame E (web-mercator meters, X from lat / Z from lon) — the SAME frame the road graph
// (roadGraphOverlay.frameEPolylines) lives in, so the minimap plots car + roads in one space with no
// projection.
class CarTelemetry {
	/** True only while drive mode is active (set on enable/disable). The minimap self-hides otherwise. */
	public active = false;
	/** Frame-E position (mercator meters). */
	public x = 0;
	public z = 0;
	/** World heading (radians) — same convention as DriveControlsNavigator.heading; forward = (cos, sin) in (X, Z). */
	public heading = 0;
	/** Signed speed (m/s). */
	public speed = 0;

	public publish(x: number, z: number, heading: number, speed: number): void {
		this.x = x;
		this.z = z;
		this.heading = heading;
		this.speed = speed;
	}

	public setActive(active: boolean): void {
		this.active = active;
	}
}

/** Process-wide singleton. */
export const carTelemetry = new CarTelemetry();
