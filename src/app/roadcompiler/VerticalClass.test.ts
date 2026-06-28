import {classify, targetHeight} from "./VerticalClass";

describe("classify — tags → vertical class (roadmap §1.1)", () => {
	test("bridge=yes → +1, layer carried as ordinal", () => {
		const c = classify({isBridge: true, bridgeLayer: 2});
		expect(c.verticalClass).toBe(1);
		expect(c.layerOrdinal).toBe(2);
	});

	test("bridge with no explicit layer → +1, ordinal 0", () => {
		expect(classify({isBridge: true}).verticalClass).toBe(1);
		expect(classify({isBridge: true}).layerOrdinal).toBe(0);
	});

	test("tunnel → -1", () => {
		expect(classify({isTunnel: true}).verticalClass).toBe(-1);
	});

	test("negative layer (no bridge) → -1 (underground)", () => {
		expect(classify({layer: -1}).verticalClass).toBe(-1);
		expect(classify({layer: -2}).layerOrdinal).toBe(-2);
	});

	test("plain road → 0", () => {
		expect(classify({}).verticalClass).toBe(0);
		expect(classify({layer: 0}).verticalClass).toBe(0);
	});

	test("bridge wins over a stray negative layer (preference is elevation)", () => {
		// A bridge tagged with an odd layer is still elevated; ordinal keeps the layer value.
		expect(classify({isBridge: true, layer: -1}).verticalClass).toBe(1);
	});

	test("positive layer alone (no bridge tag) is NOT elevated — needs the bridge tag", () => {
		// layer>0 without bridge is ordinary stacking metadata, not a deck preference.
		expect(classify({layer: 1}).verticalClass).toBe(0);
	});
});

describe("targetHeight — absolute height = DEM ± clearance, never layer×constant", () => {
	test("ground (0) targets the DEM exactly", () => {
		expect(targetHeight(0, 12.3)).toBeCloseTo(12.3, 9);
	});

	test("elevated (+1) targets DEM + clearance (default ~5.5)", () => {
		expect(targetHeight(1, 0)).toBeCloseTo(5.5, 9);
		expect(targetHeight(1, 10, {clearance: 5.5})).toBeCloseTo(15.5, 9);
	});

	test("clearance is the refinable knob — a tall bridge is large clearance, NOT layer×k", () => {
		// GGB is layer≈1 but ~67 m: the height comes from clearance, the layer ordinal is irrelevant here.
		expect(targetHeight(1, 0, {clearance: 67})).toBeCloseTo(67, 9);
	});

	test("underground (-1) targets DEM - depth", () => {
		expect(targetHeight(-1, 20, {depth: 6})).toBeCloseTo(14, 9);
	});
});
