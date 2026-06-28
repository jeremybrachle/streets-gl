import {solveHeightField, SolverGraph, SolverNode, SolverEdge} from "./HeightFieldSolver";
import {VerticalClass} from "./VerticalClass";
import {BridgeCorridor, deckHeightAt} from "../bridge/BridgeDeck";

// --- helpers -------------------------------------------------------------------------------------

/** A straight chain of N nodes spaced `spacing` m along +x; class set per node; ends optionally fixed. */
function straightChain(
	classes: VerticalClass[],
	spacing: number,
	dem: number,
	fixedEnds: boolean
): SolverGraph {
	const nodes: SolverNode[] = classes.map((c, i) => ({
		id: i,
		dem,
		verticalClass: c,
		fixed: fixedEnds && (i === 0 || i === classes.length - 1)
	}));
	const edges: SolverEdge[] = [];
	for (let i = 0; i < classes.length - 1; i++) {
		edges.push({a: i, b: i + 1, length: spacing});
	}
	return {nodes, edges};
}

// --- tests ---------------------------------------------------------------------------------------

describe("solveHeightField — invariants", () => {
	test("a class-0-only flat-DEM chain stays at the DEM", () => {
		const graph = straightChain(Array(11).fill(0), 100, 12, false);
		const {heights} = solveHeightField(graph, {});
		for (const n of graph.nodes) {
			expect(heights.get(n.id as number)).toBeCloseTo(12, 6);
		}
	});

	test("grade NEVER exceeds the cap even when the preference demands a steep climb", () => {
		// One ground anchor at 0, one elevated node wanting +40 only 100 m away: unconstrained that is a
		// 40% grade. With a hard 6% cap the deck CANNOT fully rise — the cap wins over the preference.
		const graph: SolverGraph = {
			nodes: [
				{id: 0, dem: 0, verticalClass: 0, fixed: true},
				{id: 1, dem: 0, verticalClass: 1}
			],
			edges: [{a: 0, b: 1, length: 100}]
		};
		const {heights, maxGradeObserved} = solveHeightField(graph, {maxGrade: 0.06, clearance: 40});
		expect(maxGradeObserved).toBeLessThanOrEqual(0.06 + 1e-6);
		expect(heights.get(1)).toBeLessThanOrEqual(6 + 1e-6); // 0.06 * 100m
	});

	test("solve is deterministic / repeatable — same graph, identical field", () => {
		const classes: VerticalClass[] = [0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0];
		const g1 = straightChain(classes, 200, 0, true);
		const g2 = straightChain(classes, 200, 0, true);
		const r1 = solveHeightField(g1, {maxGrade: 0.06, clearance: 30});
		const r2 = solveHeightField(g2, {maxGrade: 0.06, clearance: 30});
		for (const n of g1.nodes) {
			expect(r1.heights.get(n.id as number)).toBeCloseTo(r2.heights.get(n.id as number), 9);
		}
	});
});

describe("solveHeightField — reproduces deckHeightAt's flat-span-plus-ramps profile (Bay params)", () => {
	// Bay Bridge ground-truth parameters (deckHeight 40, maxGrade 0.06) but with GENEROUS approach so
	// deckHeightAt honors its own grade cap (apples-to-apples). The real Bay corridor only has ~400 m of
	// approach, where deckHeightAt deliberately exceeds 6% — a bootstrap compromise the hard-capped
	// solver fixes by construction (covered separately below).
	const SPACING = 100;
	const N = 51; // x = 0..5000
	const DECK = 40;
	const MAX_GRADE = 0.06;
	const SPAN_START_X = 1500;
	const SPAN_END_X = 3500;

	const classes: VerticalClass[] = [];
	for (let i = 0; i < N; i++) {
		const x = i * SPACING;
		classes.push(x >= SPAN_START_X && x <= SPAN_END_X ? 1 : 0);
	}
	const graph = straightChain(classes, SPACING, 0, true);

	const corridor: BridgeCorridor = {
		centerline: [[0, 0], [(N - 1) * SPACING, 0]],
		halfWidth: 50,
		deckHeight: DECK,
		rampLength: 0,      // let the grade cap set the ramp length (eff = 1.5*40/0.06 = 1000 m)
		maxGrade: MAX_GRADE,
		spanStart: SPAN_START_X,
		spanEnd: SPAN_END_X
	};

	const {heights, maxGradeObserved} = solveHeightField(graph, {maxGrade: MAX_GRADE, clearance: DECK});

	const deckAt = (x: number): number => deckHeightAt(corridor, x, 0, 0) ?? 0;

	test("grade cap honored on every edge", () => {
		expect(maxGradeObserved).toBeLessThanOrEqual(MAX_GRADE + 1e-6);
	});

	// A tiny (<2 m on a 40 m deck) bending "ring" at the foot/crest is an expected artifact of the
	// smoothness term — cosmetic, well under drivable tolerance, and tunable later (Phase B.4). Tests
	// allow for it rather than pretending the emergent curve is bit-identical to the closed form.
	const RING = 2;

	test("flat span: interior elevated nodes reach deck height", () => {
		// Interior of the span (away from the shore, where bending bends toward the descending ramp).
		for (let i = 0; i < N; i++) {
			const x = i * SPACING;
			if (x >= SPAN_START_X + 400 && x <= SPAN_END_X - 400) {
				expect(Math.abs(heights.get(i) - DECK)).toBeLessThan(RING);
			}
		}
	});

	test("DEM-anchored ground far from the span", () => {
		expect(heights.get(0)).toBeCloseTo(0, 6);             // fixed boundary, exact
		expect(heights.get(N - 1)).toBeCloseTo(0, 6);
		expect(Math.abs(heights.get(2))).toBeLessThan(RING);  // x=200, past the ramp foot, ≈ DEM
	});

	test("ramps rise to the deck then fall back to the DEM (monotone within the bending ring)", () => {
		const mid = Math.floor(N / 2);
		for (let i = 1; i <= mid; i++) {
			expect(heights.get(i)).toBeGreaterThanOrEqual(heights.get(i - 1) - RING);
		}
		for (let i = mid + 1; i < N; i++) {
			expect(heights.get(i)).toBeLessThanOrEqual(heights.get(i - 1) + RING);
		}
		// And the overall climb really happens: the crest is a full deck above the feet.
		expect(heights.get(mid) - heights.get(0)).toBeGreaterThan(DECK - RING);
	});

	test("same flat-span-plus-ramps SHAPE as deckHeightAt (within the smoothstep-vs-emergent band)", () => {
		// The solver's ramp EMERGES from grade-cap + bending; deckHeightAt's is a closed-form smoothstep
		// over a different ramp length. They are different VALID curves (heights are tunable later), so we
		// assert the same PROFILE — flat deck mid-span, grade-limited ramps to the DEM — within a band
		// that documents the legitimate straight/grade-cap-vs-smoothstep difference.
		let maxDiff = 0;
		for (let i = 0; i < N; i++) {
			maxDiff = Math.max(maxDiff, Math.abs(heights.get(i) - deckAt(i * SPACING)));
		}
		expect(maxDiff).toBeLessThanOrEqual(0.3 * DECK); // ≤12 m on a 40 m deck (mid-ramp, where the curves diverge)
	});
});

describe("solveHeightField — repeatable on a DIFFERENT region (genericity, no per-bridge code)", () => {
	test("a different deck/grade still yields flat span + grade-capped ramps + DEM ends", () => {
		const classes: VerticalClass[] = [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0];
		const graph = straightChain(classes, 150, 5, true); // DEM = 5 here
		const {heights, maxGradeObserved} = solveHeightField(graph, {maxGrade: 0.08, clearance: 20});
		expect(maxGradeObserved).toBeLessThanOrEqual(0.08 + 1e-6);
		expect(heights.get(0)).toBeCloseTo(5, 4);            // ground anchored at this region's DEM
		expect(heights.get(classes.length - 1)).toBeCloseTo(5, 4);
		expect(Math.abs(heights.get(7) - 25)).toBeLessThan(1); // mid-span ≈ DEM(5) + clearance(20)
	});
});
