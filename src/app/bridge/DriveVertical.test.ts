import {selectSupport, stepFall, SupportOptions} from "./DriveVertical";

const OPTS: SupportOptions = {attachBand: 2, detachDrop: 1.5};

describe("selectSupport — surface choice with hysteresis", () => {
	test("off-corridor (deck null) rides the DEM, detached", () => {
		const r = selectSupport(0, null, 0, true, OPTS);
		expect(r.height).toBe(0);
		expect(r.onDeck).toBe(false);
	});

	test("on the deck stays on the deck (small bump within detachDrop)", () => {
		// Car at 72.5, deck at 73 — dropped 0.5 (< detachDrop 1.5), still attached.
		const r = selectSupport(72.5, 73, 0, true, OPTS);
		expect(r.onDeck).toBe(true);
		expect(r.height).toBe(73);
	});

	test("driving UNDER the span: on the DEM far below the deck does NOT attach", () => {
		// Car on the ground at ~1, deck 73 overhead, not previously on it → stays on the DEM.
		const r = selectSupport(1, 73, 1, false, OPTS);
		expect(r.onDeck).toBe(false);
		expect(r.height).toBe(1);
	});

	test("re-entry at a ramp end: ground ≈ deck height → attaches", () => {
		// At the ramp foot the deck meets the DEM, so currentY (on the DEM) is within attachBand.
		const r = selectSupport(20, 21, 20, false, OPTS);
		expect(r.onDeck).toBe(true);
		expect(r.height).toBe(21);
	});

	test("driving off the edge: dropped well below the deck detaches even with deck present", () => {
		// Was on the deck (73) but has fallen to 70 (drop 3 > detachDrop 1.5) → detach to the DEM.
		const r = selectSupport(70, 73, 0, true, OPTS);
		expect(r.onDeck).toBe(false);
		expect(r.height).toBe(0);
	});

	test("not previously on the deck and not near it stays off (no snap-up)", () => {
		const r = selectSupport(5, 73, 5, false, OPTS);
		expect(r.onDeck).toBe(false);
		expect(r.height).toBe(5);
	});
});

describe("stepFall — gravity toward the support", () => {
	const G = 60;

	test("grounded (y at support) stays planted with zero velocity", () => {
		const r = stepFall(10, 0, 10, G, 0.016);
		expect(r.y).toBe(10);
		expect(r.vy).toBe(0);
	});

	test("below the support (ramp/terrain rose) snaps up, no residual velocity", () => {
		const r = stepFall(8, 0, 10, G, 0.016);
		expect(r.y).toBe(10);
		expect(r.vy).toBe(0);
	});

	test("above the support falls — velocity goes negative, height drops", () => {
		const r = stepFall(73, 0, 0, G, 0.016);
		expect(r.vy).toBeLessThan(0);
		expect(r.y).toBeLessThan(73);
		expect(r.y).toBeGreaterThan(0);
	});

	test("a step that would overshoot the ground catches exactly on it", () => {
		// Just above the support with a big downward velocity → lands on the support, velocity cleared.
		const r = stepFall(0.1, -100, 0, G, 0.1);
		expect(r.y).toBe(0);
		expect(r.vy).toBe(0);
	});

	test("velocity accumulates over successive airborne steps (real fall)", () => {
		let y = 73;
		let vy = 0;
		const dt = 0.016;
		const firstVy = stepFall(y, vy, 0, G, dt).vy;
		// Two steps in: faster than one step (gravity compounding).
		({y, vy} = stepFall(y, vy, 0, G, dt));
		({y, vy} = stepFall(y, vy, 0, G, dt));
		expect(vy).toBeLessThan(firstVy);
		expect(y).toBeLessThan(73);
	});

	test("a fall from deck height reaches the ground in a sane time (~1–2s)", () => {
		let y = 73;
		let vy = 0;
		const dt = 1 / 60;
		let t = 0;
		for (let i = 0; i < 600 && y > 0; i++) {
			({y, vy} = stepFall(y, vy, 0, G, dt));
			t += dt;
		}
		expect(y).toBe(0);
		expect(t).toBeGreaterThan(0.5);
		expect(t).toBeLessThan(3);
	});
});
