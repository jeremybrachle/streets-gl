import {BridgeRegistry} from "./BridgeRegistry";
import {BridgeCorridor} from "./BridgeDeck";

const flat = (deckHeight: number): BridgeCorridor => ({
	centerline: [[0, 0], [300, 0]],
	halfWidth: 5,
	deckHeight,
	rampLength: 10,
	maxGrade: 0.5,
});

describe("BridgeRegistry.query", () => {
	test("returns null off every corridor (open-world DEM fallback)", () => {
		const r = new BridgeRegistry();
		r.corridors = [flat(20)];
		expect(r.query(150, 100, 0)).toBeNull();
	});

	test("returns the deck height on the main span", () => {
		const r = new BridgeRegistry();
		r.corridors = [flat(20)];
		expect(r.query(150, 0, 0)).toBeCloseTo(20, 6);
	});

	test("picks the highest deck where corridors overlap (no clipping under a higher deck)", () => {
		const r = new BridgeRegistry();
		r.corridors = [flat(20), flat(35)];
		expect(r.query(150, 0, 0)).toBeCloseTo(35, 6);
	});

	test("seeds the Golden Gate corridor by default", () => {
		expect(new BridgeRegistry().corridors.length).toBeGreaterThan(0);
	});
});

describe("BridgeRegistry persistence", () => {
	test("resetToDefaults restores changed tunables", () => {
		const r = new BridgeRegistry();
		r.corridors = [{...flat(20), id: 'test'}];
		r.captureDefaults();

		r.corridors[0].deckHeight = 999;
		r.corridors[0].rampLength = 5;
		r.resetToDefaults();

		expect(r.corridors[0].deckHeight).toBeCloseTo(20, 6);
		expect(r.corridors[0].rampLength).toBeCloseTo(10, 6);
	});

	test("save/load are safe no-ops when localStorage is unavailable (node)", () => {
		const r = new BridgeRegistry();
		expect(() => {
			r.save();
			r.load();
		}).not.toThrow();
	});
});
