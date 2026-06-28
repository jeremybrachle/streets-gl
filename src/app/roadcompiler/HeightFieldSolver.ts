// Road-compiler: the height-field solver core (roadmap §1.2). The MOAT.
//
// Given a road GRAPH where every node carries a DEM and a vertical class (−1/0/+1 from
// VerticalClass.classify), solve for a per-node height field h_v that is:
//   • close to each node's class TARGET (elevated decks want to be up, ground wants the DEM),
//   • SMOOTH (a "RollerCoaster Tycoon track" — no kinks/bumps), and
//   • DRIVABLE: |Δh|/length never exceeds a hard grade cap on any edge.
//
// Ramps and transitions are NOT authored — they EMERGE from the grade cap + smoothness where an
// elevated chain meets its ground neighbours (OSM already splits the bridge way from its approaches
// at the shared node, so the class change is in the data for free). This single algorithm is applied
// UNIFORMLY to every road: no per-bridge code, no location-specific code. It reproduces the
// hand-written deckHeightAt() flat-span-plus-ramps profile on an isolated chain (the regression
// fixture) and generalizes to the whole connected network.
//
// Method: projected Gauss–Seidel (coordinate descent). Each sweep exactly minimizes the convex
// quadratic energy (class pull + bending smoothness) one free node at a time, then projects every
// edge back onto the feasible grade band |Δh| ≤ maxGrade·len. Both steps are local and
// streaming-friendly; the bake (B.1) runs this OFFLINE over a whole region. Pure — no engine deps.

import {VerticalClass, targetHeight, HeightParams} from "./VerticalClass";

export type NodeId = string | number;

export interface SolverNode {
	id: NodeId;
	/** DEM height under this node (the ground truth the field is anchored to). */
	dem: number;
	verticalClass: VerticalClass;
	/** Hard Dirichlet: held exactly at its class target; the solver never moves it. */
	fixed?: boolean;
}

export interface SolverEdge {
	a: NodeId;
	b: NodeId;
	/** Horizontal run between the two nodes, meters (frame-E). Precomputed upstream (B.1). */
	length: number;
}

export interface SolverGraph {
	nodes: SolverNode[];
	edges: SolverEdge[];
}

export interface ClassPullWeights {
	ground?: number;
	elevated?: number;
	underground?: number;
}

export interface SolverConfig extends HeightParams {
	/** Hard max |Δh|/length per edge (rise/run). Default 0.08 (8%). */
	maxGrade?: number;
	/** Pull weight toward the class target, per class. */
	classPullWeight?: ClassPullWeights;
	/** Bending (second-difference) smoothness weight — the "track" term that rounds ramps. */
	smoothnessWeight?: number;
	/** Max relaxation sweeps. */
	iterations?: number;
	/** Grade-projection sub-iterations per sweep. */
	projectionIterations?: number;
	/** Convergence threshold on the max per-node height change across a sweep. */
	tolerance?: number;
}

export interface SolveResult {
	heights: Map<NodeId, number>;
	iterations: number;
	converged: boolean;
	/** Largest |Δh|/length observed over all edges in the final field. */
	maxGradeObserved: number;
}

const DEFAULTS = {
	maxGrade: 0.08,
	classPullWeight: {ground: 3, elevated: 500, underground: 500} as Required<ClassPullWeights>,
	smoothnessWeight: 300,
	iterations: 5000,
	projectionIterations: 30,
	tolerance: 1e-6
};

/** [centerIndex, leftNeighbor, rightNeighbor] — one discrete bending stencil (h_l − 2h_m + h_r). */
type Triple = [number, number, number];

export function solveHeightField(graph: SolverGraph, config: SolverConfig = {}): SolveResult {
	const maxGrade = config.maxGrade ?? DEFAULTS.maxGrade;
	const pull: Required<ClassPullWeights> = {...DEFAULTS.classPullWeight, ...config.classPullWeight};
	const lambda = config.smoothnessWeight ?? DEFAULTS.smoothnessWeight;
	const maxIters = config.iterations ?? DEFAULTS.iterations;
	const projIters = config.projectionIterations ?? DEFAULTS.projectionIterations;
	const tol = config.tolerance ?? DEFAULTS.tolerance;
	const heightParams: HeightParams = {clearance: config.clearance, depth: config.depth};

	const n = graph.nodes.length;
	const index = new Map<NodeId, number>();
	graph.nodes.forEach((node, i) => index.set(node.id, i));

	const target = new Float64Array(n);
	const pullWeight = new Float64Array(n);
	const fixed = new Array<boolean>(n);
	const h = new Float64Array(n);

	for (let i = 0; i < n; i++) {
		const node = graph.nodes[i];
		target[i] = targetHeight(node.verticalClass, node.dem, heightParams);
		pullWeight[i] =
			node.verticalClass === 1 ? pull.elevated : node.verticalClass === -1 ? pull.underground : pull.ground;
		fixed[i] = !!node.fixed;
		h[i] = target[i]; // warm start at the preference
	}

	// Adjacency (for bending neighbours) and the edge list mapped to indices (for grade projection).
	const neighbors: number[][] = Array.from({length: n}, () => []);
	const edgeIdx: {a: number; b: number; length: number}[] = [];
	for (const e of graph.edges) {
		const a = index.get(e.a);
		const b = index.get(e.b);
		if (a === undefined || b === undefined || a === b) {
			continue;
		}
		neighbors[a].push(b);
		neighbors[b].push(a);
		edgeIdx.push({a, b, length: e.length});
	}

	// Bending stencils: one triple centered at every node with ≥2 neighbours (each distinct pair).
	const triples: Triple[] = [];
	const triplesByNode: number[][] = Array.from({length: n}, () => []); // node → indices into `triples`
	for (let m = 0; m < n; m++) {
		const nb = neighbors[m];
		for (let i = 0; i < nb.length; i++) {
			for (let j = i + 1; j < nb.length; j++) {
				const t: Triple = [nb[i], m, nb[j]];
				const ti = triples.push(t) - 1;
				triplesByNode[t[0]].push(ti);
				triplesByNode[t[1]].push(ti);
				triplesByNode[t[2]].push(ti);
			}
		}
	}

	let converged = false;
	let sweep = 0;
	for (; sweep < maxIters; sweep++) {
		let maxChange = 0;

		// --- Gauss–Seidel relaxation: exactly minimize the local quadratic at each free node. ---
		for (let m = 0; m < n; m++) {
			if (fixed[m]) {
				continue;
			}

			// Local energy in h[m]: A·h² + B·h + const.  Solve h* = −B/(2A).
			let A = pullWeight[m];
			let B = -2 * pullWeight[m] * target[m];

			for (const ti of triplesByNode[m]) {
				const [x, y, z] = triples[ti];
				const c = m === y ? -2 : 1; // coefficient of h[m] in (h_x − 2h_y + h_z)
				const r = h[x] - 2 * h[y] + h[z];
				const k = r - c * h[m]; // the residual with h[m]'s own contribution removed
				A += lambda * c * c;
				B += 2 * lambda * c * k;
			}

			if (A <= 0) {
				continue;
			}
			const next = -B / (2 * A);
			maxChange = Math.max(maxChange, Math.abs(next - h[m]));
			h[m] = next;
		}

		// --- Grade-cap projection: pull every over-steep edge back onto the feasible band. ---
		for (let p = 0; p < projIters; p++) {
			let moved = 0;
			for (const e of edgeIdx) {
				const cap = maxGrade * e.length;
				const d = h[e.b] - h[e.a];
				const over = Math.abs(d) - cap;
				if (over <= 1e-12) {
					continue;
				}
				const dir = Math.sign(d);
				const fa = fixed[e.a];
				const fb = fixed[e.b];
				if (fa && fb) {
					continue; // both pinned — infeasible edge, leave as-is (caller's geometry problem)
				} else if (fa) {
					h[e.b] -= dir * over;
				} else if (fb) {
					h[e.a] += dir * over;
				} else {
					h[e.a] += dir * (over / 2);
					h[e.b] -= dir * (over / 2);
				}
				moved = Math.max(moved, over);
			}
			if (moved <= 1e-12) {
				break;
			}
		}

		if (maxChange < tol) {
			converged = true;
			sweep++;
			break;
		}
	}

	const heights = new Map<NodeId, number>();
	graph.nodes.forEach((node, i) => heights.set(node.id, h[i]));

	let maxGradeObserved = 0;
	for (const e of edgeIdx) {
		maxGradeObserved = Math.max(maxGradeObserved, Math.abs(h[e.b] - h[e.a]) / e.length);
	}

	return {heights, iterations: sweep, converged, maxGradeObserved};
}
