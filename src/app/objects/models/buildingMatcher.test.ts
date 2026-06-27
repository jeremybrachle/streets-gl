import {aspectOf, pickBuildingIndex, SourceFootprint} from "./buildingMatcher";

describe('aspectOf', () => {
	it('is orientation-independent and ≥ 1', () => {
		expect(aspectOf(20, 10)).toBeCloseTo(2);
		expect(aspectOf(10, 20)).toBeCloseTo(2);
		expect(aspectOf(15, 15)).toBeCloseTo(1);
	});
});

describe('pickBuildingIndex', () => {
	// A square, a 2:1, and a 4:1 source.
	const sources: SourceFootprint[] = [
		{width: 10, depth: 10}, // aspect 1
		{width: 20, depth: 10}, // aspect 2
		{width: 40, depth: 10}  // aspect 4
	];

	it('picks the aspect-closest source for a long thin footprint', () => {
		// Footprint 40×10 (aspect 4) with a tight band → only the 4:1 source qualifies.
		expect(pickBuildingIndex(40, 10, sources, 0.1, 0.01)).toBe(2);
	});

	it('picks the square source for a square footprint', () => {
		expect(pickBuildingIndex(12, 12, sources, 0.7, 0.01)).toBe(0);
	});

	it('is deterministic for the same seed', () => {
		const a = pickBuildingIndex(25, 12, sources, 0.42);
		const b = pickBuildingIndex(25, 12, sources, 0.42);
		expect(a).toBe(b);
	});

	it('never returns a source whose aspect is outside the band', () => {
		// Square footprint (aspect 1): square(0) and 2:1(0.69) fall in band 0.8; the 4:1(log4=1.39) does not.
		const picks = new Set<number>();
		for (let s = 0; s < 50; s++) {
			picks.add(pickBuildingIndex(12, 12, sources, s * 0.137, 0.8));
		}
		expect(picks.has(2)).toBe(false);
		expect(picks.size).toBeGreaterThan(1); // variety: both in-band sources get used
	});

	it('returns 0 when there are no sources', () => {
		expect(pickBuildingIndex(20, 10, [], 0.5)).toBe(0);
	});
});
