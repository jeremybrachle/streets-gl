import {BridgeCorridor, deckHeightAt, projectPointToPolyline, arcLengthAtNode} from "./BridgeDeck";

// A straight 300m corridor along +x, deck 20 high. rampLength 10 is intentionally TOO SHORT
// for maxGrade 0.5 (needs 1.5*20/0.5 = 60m), so the ramp must auto-extend to 60m each end.
const STRAIGHT: BridgeCorridor = {
	centerline: [[0, 0], [300, 0]],
	halfWidth: 5,
	deckHeight: 20,
	rampLength: 10,
	maxGrade: 0.5,
};
const GROUND = 0;
const EXPECTED_RAMP = 60; // 1.5 * 20 / 0.5

describe("projectPointToPolyline", () => {
	test("arc-length and lateral on a straight corridor", () => {
		const p = projectPointToPolyline(STRAIGHT.centerline, 120, 3);
		expect(p.s).toBeCloseTo(120, 5);
		expect(p.lateral).toBeCloseTo(3, 5);
		expect(p.totalLength).toBeCloseTo(300, 5);
	});

	test("clamps to endpoints past the ends", () => {
		const p = projectPointToPolyline(STRAIGHT.centerline, 350, 0);
		expect(p.s).toBeCloseTo(300, 5);
		expect(p.lateral).toBeCloseTo(50, 5);
	});
});

describe("deckHeightAt — corridor membership", () => {
	test("main span returns the flat deck height", () => {
		expect(deckHeightAt(STRAIGHT, 150, 0, GROUND)).toBeCloseTo(20, 6);
	});

	test("outside the lateral half-width returns null (open-world fallback)", () => {
		expect(deckHeightAt(STRAIGHT, 150, 6, GROUND)).toBeNull();
	});

	test("far past the end returns null", () => {
		expect(deckHeightAt(STRAIGHT, 400, 0, GROUND)).toBeNull();
	});

	test("degenerate corridor (<2 points) returns null", () => {
		expect(deckHeightAt({...STRAIGHT, centerline: [[0, 0]]}, 0, 0, GROUND)).toBeNull();
	});
});

describe("deckHeightAt — ramp contract", () => {
	test("ramp ends meet ground and deck exactly (seamless joins)", () => {
		expect(deckHeightAt(STRAIGHT, 0, 0, GROUND)).toBeCloseTo(GROUND, 6);
		expect(deckHeightAt(STRAIGHT, 300, 0, GROUND)).toBeCloseTo(GROUND, 6);
		expect(deckHeightAt(STRAIGHT, EXPECTED_RAMP, 0, GROUND)).toBeCloseTo(20, 6);
		expect(deckHeightAt(STRAIGHT, 300 - EXPECTED_RAMP, 0, GROUND)).toBeCloseTo(20, 6);
	});

	test("auto-extends a too-short ramp to honor maxGrade", () => {
		// At the requested 10m ramp the deck would already be high; instead it's still climbing
		// at 60m, proving the ramp extended past the requested length.
		expect(deckHeightAt(STRAIGHT, 10, 0, GROUND)!).toBeLessThan(20);
		expect(deckHeightAt(STRAIGHT, 59, 0, GROUND)!).toBeLessThan(20);
	});

	test("profile is monotonic up the on-ramp (no dips/bumps)", () => {
		let prev = -Infinity;
		for (let s = 0; s <= EXPECTED_RAMP; s += 0.5) {
			const h = deckHeightAt(STRAIGHT, s, 0, GROUND)!;
			expect(h).toBeGreaterThanOrEqual(prev - 1e-9);
			prev = h;
		}
	});

	test("max grade never exceeds maxGrade anywhere", () => {
		const step = 0.25;
		let maxSlope = 0;
		let prev = deckHeightAt(STRAIGHT, 0, 0, GROUND)!;
		for (let s = step; s <= 300; s += step) {
			const h = deckHeightAt(STRAIGHT, s, 0, GROUND)!;
			maxSlope = Math.max(maxSlope, Math.abs(h - prev) / step);
			prev = h;
		}
		expect(maxSlope).toBeLessThanOrEqual(STRAIGHT.maxGrade + 1e-6);
	});

	test("profile is C¹ (bounded curvature — no spikes)", () => {
		const step = 0.5;
		const hs: number[] = [];
		for (let s = 0; s <= 300; s += step) {
			hs.push(deckHeightAt(STRAIGHT, s, 0, GROUND)!);
		}
		// Second difference (∝ curvature) stays small: a smoothstep over 60m with dh=20 peaks at
		// |f''| = 6*dh/eff² = 6*20/3600 ≈ 0.033 per meter of slope-change.
		let maxSecond = 0;
		for (let i = 1; i < hs.length - 1; i++) {
			maxSecond = Math.max(maxSecond, Math.abs(hs[i + 1] - 2 * hs[i] + hs[i - 1]) / (step * step));
		}
		expect(maxSecond).toBeLessThan(0.05);
	});

	test("honors a longer requested rampLength when it is already gentle enough", () => {
		const gentle: BridgeCorridor = {...STRAIGHT, rampLength: 80, deckHeight: 20, maxGrade: 0.5};
		// 80m > the 60m grade minimum, so the ramp should span ~80m: still below deck at 79m.
		expect(deckHeightAt(gentle, 79, 0, GROUND)!).toBeLessThan(20);
		expect(deckHeightAt(gentle, 80, 0, GROUND)!).toBeCloseTo(20, 6);
	});

	test("keeps a flat main span even for a very tall deck (ramp capped at 0.4 of the corridor)", () => {
		// gradeMinRamp = 1.5*500/0.01 = 75000m, far longer than the corridor — without the cap the
		// ramps would eat the whole span and it would never reach deckHeight. The cap (0.4*300=120m
		// each end) leaves a flat span [120, 180] that DOES reach the full height.
		const tall: BridgeCorridor = {...STRAIGHT, deckHeight: 500, maxGrade: 0.01};
		expect(deckHeightAt(tall, 150, 0, GROUND)).toBeCloseTo(500, 6); // center
		expect(deckHeightAt(tall, 121, 0, GROUND)).toBeCloseTo(500, 6); // just inside the flat span
		expect(deckHeightAt(tall, 179, 0, GROUND)).toBeCloseTo(500, 6);
		expect(deckHeightAt(tall, 60, 0, GROUND)!).toBeLessThan(500);   // still climbing on the ramp
	});

	test("works for a downhill deck (ground above deck)", () => {
		const high = 50;
		expect(deckHeightAt(STRAIGHT, 0, 0, high)).toBeCloseTo(high, 6);
		expect(deckHeightAt(STRAIGHT, 150, 0, high)).toBeCloseTo(20, 6);
	});
});

describe("arcLengthAtNode", () => {
	test("sums segment lengths up to the node", () => {
		const line: [number, number][] = [[0, 0], [3, 0], [3, 4]];
		expect(arcLengthAtNode(line, 0)).toBe(0);
		expect(arcLengthAtNode(line, 1)).toBeCloseTo(3, 6);
		expect(arcLengthAtNode(line, 2)).toBeCloseTo(7, 6);
		expect(arcLengthAtNode(line, 99)).toBeCloseTo(7, 6); // clamps past the end
	});
});

describe("deckHeightAt — declared bridge span (elevated only over the water)", () => {
	// 600m straight corridor; the elevated bridge span (the water crossing) is [200, 400]. maxGrade 1
	// is gentle enough that the 100m rampLength governs, so each approach ramp is [shore-100, shore].
	const SPAN: BridgeCorridor = {
		centerline: [[0, 0], [600, 0]],
		halfWidth: 5,
		deckHeight: 30,
		rampLength: 100,
		maxGrade: 1,
		spanStart: 200,
		spanEnd: 400,
	};

	test("flat at deckHeight across the whole span (over the water)", () => {
		expect(deckHeightAt(SPAN, 200, 0, 0)).toBeCloseTo(30, 6); // south shore
		expect(deckHeightAt(SPAN, 300, 0, 0)).toBeCloseTo(30, 6); // mid span
		expect(deckHeightAt(SPAN, 400, 0, 0)).toBeCloseTo(30, 6); // north shore
	});

	test("ramps down from the shore onto the land approach", () => {
		expect(deckHeightAt(SPAN, 150, 0, 0)!).toBeCloseTo(15, 6); // half-way down the south ramp
		expect(deckHeightAt(SPAN, 450, 0, 0)!).toBeCloseTo(15, 6); // half-way down the north ramp
		expect(deckHeightAt(SPAN, 101, 0, 0)!).toBeLessThan(0.5);  // near the ramp foot ≈ ground
	});

	test("meets the real terrain at the ramp foot when the ground is elevated", () => {
		expect(deckHeightAt(SPAN, 101, 0, 12)!).toBeCloseTo(12, 0); // lands on ground = 12, not 0
	});

	test("returns null beyond the ramp foot — the land approach stays normal ground road", () => {
		expect(deckHeightAt(SPAN, 99, 0, 0)).toBeNull();  // just past the south ramp foot
		expect(deckHeightAt(SPAN, 50, 0, 0)).toBeNull();  // far inland, south
		expect(deckHeightAt(SPAN, 501, 0, 0)).toBeNull(); // just past the north ramp foot
	});
});
