import {ombbFromCorners, computeBuildingPlacement, OMBBRect, SourceDims} from "./buildingPlacement";

describe('ombbFromCorners', () => {
	// Axis-aligned 10 (X) × 4 (Z) rectangle centered at (5, 2). Order [UL, BL, BR, UR] in {x,z}.
	const axisAligned = [
		{x: 0, z: 0}, {x: 0, z: 4}, {x: 10, z: 4}, {x: 10, z: 0}
	];

	it('returns center, long/short lengths, and long-axis direction', () => {
		const r = ombbFromCorners(axisAligned)!;
		expect(r.centerX).toBeCloseTo(5);
		expect(r.centerZ).toBeCloseTo(2);
		expect(r.longLen).toBeCloseTo(10);
		expect(r.shortLen).toBeCloseTo(4);
		// Long side runs along X.
		expect(Math.abs(r.longDirX)).toBeCloseTo(1);
		expect(r.longDirZ).toBeCloseTo(0);
	});

	it('picks the longer of the two incident edges regardless of corner order', () => {
		// Same rectangle but long side along Z: 4 (X) × 10 (Z).
		const r = ombbFromCorners([{x: 0, z: 0}, {x: 0, z: 10}, {x: 4, z: 10}, {x: 4, z: 0}])!;
		expect(r.longLen).toBeCloseTo(10);
		expect(r.shortLen).toBeCloseTo(4);
		expect(r.longDirX).toBeCloseTo(0);
		expect(Math.abs(r.longDirZ)).toBeCloseTo(1);
	});

	it('handles a rotated (45°) rectangle', () => {
		// A square rotated 45°, side √2 → diagonal 2. Corners at (±1,0),(0,±1).
		const r = ombbFromCorners([{x: -1, z: 0}, {x: 0, z: 1}, {x: 1, z: 0}, {x: 0, z: -1}])!;
		expect(r.centerX).toBeCloseTo(0);
		expect(r.centerZ).toBeCloseTo(0);
		expect(r.longLen).toBeCloseTo(Math.SQRT2);
		expect(r.shortLen).toBeCloseTo(Math.SQRT2);
	});

	it('returns null for a degenerate box', () => {
		expect(ombbFromCorners([{x: 0, z: 0}, {x: 0, z: 0}, {x: 1, z: 0}, {x: 1, z: 0}])).toBeNull();
		expect(ombbFromCorners([{x: 0, z: 0}, {x: 1, z: 0}, {x: 2, z: 0}])).toBeNull(); // wrong count
	});
});

describe('computeBuildingPlacement', () => {
	const src: SourceDims = {width: 20, depth: 10, height: 50}; // long axis = local X

	const rectAlongX: OMBBRect = {centerX: 100, centerZ: 200, longLen: 40, shortLen: 12, longDirX: 1, longDirZ: 0};

	it('anchors at the footprint center and ground height', () => {
		const p = computeBuildingPlacement(rectAlongX, 80, src, 33);
		expect(p.anchorX).toBeCloseTo(100);
		expect(p.anchorY).toBeCloseTo(33);
		expect(p.anchorZ).toBeCloseTo(200);
	});

	it('scales each axis to fill the footprint and reach the target height', () => {
		const p = computeBuildingPlacement(rectAlongX, 80, src, 0);
		expect(p.scaleX).toBeCloseTo(40 / 20); // long → width(X)
		expect(p.scaleZ).toBeCloseTo(12 / 10); // short → depth(Z)
		expect(p.scaleY).toBeCloseTo(80 / 50);
		expect(p.yaw).toBeCloseTo(0); // long dir is +X → no rotation
	});

	it('rotates to align the long axis to the footprint long direction', () => {
		// Footprint long side runs along +Z.
		const rectAlongZ: OMBBRect = {centerX: 0, centerZ: 0, longLen: 40, shortLen: 12, longDirX: 0, longDirZ: 1};
		const p = computeBuildingPlacement(rectAlongZ, 80, src, 0);
		expect(p.yaw).toBeCloseTo(Math.PI / 2);
		// Source X (long) still maps to the footprint long side.
		expect(p.scaleX).toBeCloseTo(40 / 20);
		expect(p.scaleZ).toBeCloseTo(12 / 10);
	});

	it('adds a quarter-turn and swaps scale assignment when the source long axis is local Z', () => {
		const srcZlong: SourceDims = {width: 10, depth: 20, height: 50}; // long axis = local Z
		const p = computeBuildingPlacement(rectAlongX, 80, srcZlong, 0);
		// Long dir is +X (yaw 0); rotate -90° so source +Z points along +X.
		expect(p.yaw).toBeCloseTo(-Math.PI / 2);
		expect(p.scaleZ).toBeCloseTo(40 / 20); // source depth(Z, long) → footprint long
		expect(p.scaleX).toBeCloseTo(12 / 10); // source width(X, short) → footprint short
	});

	it('guards against zero source dimensions (no NaN/Infinity)', () => {
		const p = computeBuildingPlacement(rectAlongX, 80, {width: 0, depth: 0, height: 0}, 0);
		expect(Number.isFinite(p.scaleX)).toBe(true);
		expect(Number.isFinite(p.scaleY)).toBe(true);
		expect(Number.isFinite(p.scaleZ)).toBe(true);
	});
});
