import {extractTowerLegFootprints} from "./towerFootprints";
import {pointInConvex} from "./FootprintCollision";

// Build a synthetic two-tower bridge buffer: a sparse deck strip along X at the center Z band, plus
// two DENSE towers at x=-170 and x=+170 whose verts straddle the road (legs at z≈±18).
function makeBridgeBuffer(): Float32Array {
	const p: number[] = [];
	// Deck: sparse points across the span, central Z band, low Y.
	for (let x = -300; x <= 300; x += 10) {
		for (let z = -10; z <= 10; z += 5) {
			p.push(x, -15, z);
		}
	}
	// Two towers: dense vertical clusters, legs at z≈±18, plus a full-width top cross-beam.
	for (const tx of [-170, 170]) {
		for (let k = 0; k < 400; k++) {
			const y = -15 + (k / 400) * 100;
			p.push(tx + (k % 5) - 2, y, 18 + (k % 3));   // +Z leg
			p.push(tx + (k % 5) - 2, y, -18 - (k % 3));  // −Z leg
		}
		// Top cross-beam spanning full Z (must NOT bridge the legs into one road-blocking polygon).
		for (let z = -18; z <= 18; z += 2) {
			p.push(tx, 84, z);
		}
	}
	return new Float32Array(p);
}

describe('extractTowerLegFootprints', () => {
	const polys = extractTowerLegFootprints(makeBridgeBuffer());

	it('finds 4 leg footprints (2 towers × 2 legs)', () => {
		expect(polys.length).toBe(4);
	});

	it('keeps the roadway between the legs open (no polygon covers the center)', () => {
		for (const poly of polys) {
			expect(pointInConvex(-170, 0, poly)).toBe(false); // road center at tower 1
			expect(pointInConvex(170, 0, poly)).toBe(false);  // road center at tower 2
		}
	});

	it('each leg sits on one side of the road (|z| well outside the central band)', () => {
		for (const poly of polys) {
			const avgZ = poly.reduce((s, q) => s + q.z, 0) / poly.length;
			expect(Math.abs(avgZ)).toBeGreaterThan(12);
		}
	});

	it('returns [] for a model with no dense tower cluster', () => {
		// Uniform sparse cloud — nothing stands above the density threshold.
		const flat: number[] = [];
		for (let x = -100; x <= 100; x += 4) {
			for (let z = -10; z <= 10; z += 4) {
				flat.push(x, 0, z);
			}
		}
		expect(extractTowerLegFootprints(new Float32Array(flat))).toEqual([]);
	});
});
