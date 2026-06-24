// DriveVertical.ts — pure vertical dynamics for the drive car. Two concerns, both pure + unit-tested
// (DriveVertical.test.ts), wired into DriveControlsNavigator's per-frame ground sampling:
//
//  1. selectSupport — WHICH surface holds the car up: the elevated bridge deck, or the DEM under it.
//     Uses height-proximity + hysteresis so the car only rides the deck when it's actually ON it
//     (driven up a ramp end), and drives UNDER the span when it's down on the ground far below.
//  2. stepFall — a minimal gravity model so driving off the deck edge makes the car FALL to the
//     ground (instead of teleporting down). Grounded, it just tracks the support up ramps/terrain.
//
// No engine imports — this is plain math the navigator composes.

export interface SupportOptions {
	/**
	 * How close (vertical units) the car must already be to the deck to climb ONTO it from the ground.
	 * Small by design: at the ramp ends the deck meets the DEM, so the car is within the band and
	 * attaches; under the main span the deck is far overhead, so the car stays on the DEM and drives
	 * under it.
	 */
	attachBand: number;
	/**
	 * How far (vertical units) the car may drop BELOW the deck before it detaches (drives off the
	 * edge). Hysteresis so a small suspension bump or spring travel doesn't pop the car off the deck.
	 */
	detachDrop: number;
}

export interface SupportResult {
	/** The height the car is supported at this frame (the deck or the DEM). */
	height: number;
	/** Whether the car is attached to the deck after this step — feeds back as `wasOnDeck` next frame. */
	onDeck: boolean;
}

/**
 * Choose the support surface (elevated deck vs the DEM under it) with height-proximity + hysteresis.
 *
 * - deckHeight === null (off-corridor, off the lateral edge, or past the ramp foot): ride the ground.
 * - A deck is present here: stay on it if we were already on it and haven't dropped well below it
 *   (hysteresis), OR attach to it if the car's height is already near the deck — true at the ramp
 *   ends (deck ≈ ground), false when the car is on the DEM far beneath the span (so it drives under).
 */
export function selectSupport(
	currentY: number,
	deckHeight: number | null,
	demHeight: number,
	wasOnDeck: boolean,
	opts: SupportOptions
): SupportResult {
	if (deckHeight === null) {
		return {height: demHeight, onDeck: false};
	}

	const nearDeck = Math.abs(currentY - deckHeight) <= opts.attachBand;
	const stillOnDeck = wasOnDeck && currentY >= deckHeight - opts.detachDrop;
	const onDeck = stillOnDeck || nearDeck;

	return {height: onDeck ? deckHeight : demHeight, onDeck};
}

export interface FallResult {
	y: number;
	vy: number;
}

/**
 * Integrate the car's height under gravity toward the support surface.
 *
 * - Above the support: airborne — downward velocity accumulates and the car falls, until it catches
 *   the surface (then height snaps to the support, velocity resets to 0).
 * - At or below the support: grounded — height tracks the support exactly, so the car drives up ramps
 *   and over rising terrain (the ground pushes it up) with no residual velocity.
 *
 * `gravity` is in world-height units / s^2 (tuned in the navigator). `dt` should be frame-clamped by
 * the caller so a frame hitch can't fling the car.
 */
export function stepFall(
	y: number,
	vy: number,
	support: number,
	gravity: number,
	dt: number
): FallResult {
	if (y > support) {
		const nvy = vy - gravity * dt;
		const ny = y + nvy * dt;
		if (ny <= support) {
			return {y: support, vy: 0};
		}
		return {y: ny, vy: nvy};
	}

	return {y: support, vy: 0};
}
