import {mergePartsByTexture, recenterBuilding, buildBuildingClusters, RawPrim, BuildedBuilding} from "./buildingModel";
import {BuildingPlacement} from "./buildingPlacement";

function tri(textureKey: string, verts: number[][], idx = [0, 1, 2]): RawPrim {
	return {
		textureKey,
		pos: verts.flat(),
		nor: verts.map(() => [0, 1, 0]).flat(),
		uv: verts.map(() => [0, 0]).flat(),
		idx
	};
}

describe('mergePartsByTexture', () => {
	it('groups prims by textureKey and offsets indices per group', () => {
		const prims = [
			tri('A', [[0, 0, 0], [1, 0, 0], [0, 0, 1]]),
			tri('B', [[0, 0, 0], [0, 1, 0], [0, 0, 1]]),
			tri('A', [[2, 0, 0], [3, 0, 0], [2, 0, 1]])
		];
		const {parts} = mergePartsByTexture(prims);
		expect(parts.map(p => p.textureKey)).toEqual(['A', 'B']);
		const a = parts.find(p => p.textureKey === 'A')!;
		// Two triangles merged; second triangle's indices offset by 3 vertices.
		expect(Array.from(a.indices)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(a.position.length).toBe(18); // 6 verts × 3
	});

	it('computes the union bounds across all prims', () => {
		const prims = [
			tri('A', [[-2, 0, -1], [1, 0, 0], [0, 0, 1]]),
			tri('B', [[0, 5, 0], [3, 0, 0], [0, 0, 4]])
		];
		const {bounds} = mergePartsByTexture(prims);
		expect(bounds.minx).toBe(-2);
		expect(bounds.maxx).toBe(3);
		expect(bounds.miny).toBe(0);
		expect(bounds.maxy).toBe(5);
		expect(bounds.minz).toBe(-1);
		expect(bounds.maxz).toBe(4);
	});
});

describe('recenterBuilding', () => {
	it('centers XZ on the footprint and drops the base to y=0; returns dims', () => {
		// Footprint spans x[10..30] (center 20), z[100..140] (center 120), y[5..45] (base 5).
		const prims = [tri('A', [[10, 5, 100], [30, 45, 140], [10, 45, 100]])];
		const {parts, bounds} = mergePartsByTexture(prims);
		const dims = recenterBuilding(parts, bounds);
		expect(dims).toEqual({width: 20, depth: 40, height: 40});
		const p = parts[0].position;
		// First vertex (10,5,100) → (10-20, 5-5, 100-120) = (-10, 0, -20).
		expect([p[0], p[1], p[2]]).toEqual([-10, 0, -20]);
		// Base sits exactly at y=0 (min y over all verts).
		let minY = Infinity;
		for (let i = 1; i < p.length; i += 3) minY = Math.min(minY, p[i]);
		expect(minY).toBe(0);
	});

	it('returns zero dims for an empty building', () => {
		const {parts, bounds} = mergePartsByTexture([]);
		expect(recenterBuilding(parts, bounds)).toEqual({width: 0, depth: 0, height: 0});
	});
});

describe('buildBuildingClusters', () => {
	// One building with two facade textures (one triangle each), already recentered (base y=0).
	function building(): BuildedBuilding {
		const {parts} = mergePartsByTexture([
			tri('facadeA', [[0, 0, 0], [1, 0, 0], [0, 1, 0]]),
			tri('facadeB', [[0, 0, 0], [0, 1, 0], [0, 0, 1]])
		]);
		return {name: 'B', parts, dims: {width: 1, depth: 1, height: 1}};
	}

	const ident: BuildingPlacement = {
		anchorX: 0, anchorY: 0, anchorZ: 0, yaw: 0, scaleX: 1, scaleY: 1, scaleZ: 1
	};

	it('groups every instance into one merged mesh per facade texture', () => {
		const buildings = [building()];
		const clusters = buildBuildingClusters(buildings, [
			{buildingIndex: 0, placement: ident},
			{buildingIndex: 0, placement: {...ident, anchorX: 50, anchorZ: 50}}
		], [0, 0]);
		expect([...clusters.keys()].sort()).toEqual(['facadeA', 'facadeB']);
		// Two instances × 1 triangle each → 6 verts, 6 indices per texture bucket.
		expect(clusters.get('facadeA')!.position.length).toBe(18);
		expect(Array.from(clusters.get('facadeA')!.indices)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('applies anchor-relative translation and per-axis scale', () => {
		const buildings = [building()];
		const clusters = buildBuildingClusters(buildings, [
			{buildingIndex: 0, placement: {...ident, anchorX: 100, anchorY: 7, anchorZ: 200, scaleX: 2, scaleY: 3, scaleZ: 1}}
		], [100, 200]); // anchor = the building's own world XZ → dx=dz=0
		const p = clusters.get('facadeA')!.position;
		// Source vertex (1,0,0) → scale x2 → (2,0,0); +anchorY on Y; anchor-relative XZ (0,0).
		expect([p[3], p[4], p[5]]).toEqual([2, 7, 0]);
	});
});
