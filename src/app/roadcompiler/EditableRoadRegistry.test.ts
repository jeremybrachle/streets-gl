import {
	EditableRoadRegistry,
	EditableRoadCenterline,
	polylineLength,
	pointAtArcLength,
} from "./EditableRoadRegistry";

// Two straight roads in frame E. wayA runs along +X at z=0 from x=0..100; wayB along +X at z=50.
const wayA: EditableRoadCenterline = {osmWayId: 1, centerline: [[0, 0], [100, 0]]};
const wayB: EditableRoadCenterline = {osmWayId: 2, centerline: [[0, 50], [100, 50]]};

describe("polylineLength / pointAtArcLength", () => {
	test("length sums segment lengths", () => {
		expect(polylineLength([[0, 0], [3, 4]])).toBeCloseTo(5, 9);
		expect(polylineLength([[0, 0], [10, 0], [10, 10]])).toBeCloseTo(20, 9);
	});

	test("pointAtArcLength interpolates and clamps", () => {
		const line: [number, number][] = [[0, 0], [10, 0]];
		expect(pointAtArcLength(line, 0)).toEqual([0, 0]);
		expect(pointAtArcLength(line, 5)).toEqual([5, 0]);
		expect(pointAtArcLength(line, 999)).toEqual([10, 0]); // clamped to the end
		expect(pointAtArcLength(line, -5)).toEqual([0, 0]);   // clamped to the start
	});
});

describe("ingest / drop / count", () => {
	test("ingest adds roads, drop removes only that tile's, revision bumps", () => {
		const reg = new EditableRoadRegistry();
		const r0 = reg.revision;
		reg.ingestTile("0,0", [wayA]);
		reg.ingestTile("0,1", [wayB]);
		expect(reg.count()).toBe(2);
		expect(reg.revision).toBeGreaterThan(r0);

		reg.dropTile("0,0");
		expect(reg.count()).toBe(1);
		expect(reg.allRoads()[0].osmWayId).toBe(2);
	});

	test("re-ingesting a tile replaces its previous set (no duplication on reload)", () => {
		const reg = new EditableRoadRegistry();
		reg.ingestTile("0,0", [wayA]);
		reg.ingestTile("0,0", [wayA, wayB]);
		expect(reg.count()).toBe(2);
	});

	test("ingesting an empty/undefined set clears a stale tile", () => {
		const reg = new EditableRoadRegistry();
		reg.ingestTile("0,0", [wayA]);
		reg.ingestTile("0,0", []);
		expect(reg.count()).toBe(0);
		reg.ingestTile("0,0", undefined);
		expect(reg.count()).toBe(0);
	});

	test("stored centerlines are copied, not aliased to caller arrays", () => {
		const reg = new EditableRoadRegistry();
		const list = [wayA];
		reg.ingestTile("0,0", list);
		list.length = 0; // mutate the caller's array
		expect(reg.count()).toBe(1);
	});
});

describe("pick — nearest editable centerline within tolerance", () => {
	const reg = new EditableRoadRegistry();
	reg.ingestTile("0,0", [wayA, wayB]);

	test("a click near wayA returns wayA with arc-length + lateral", () => {
		const hit = reg.pick(40, 2, 10);
		expect(hit).not.toBeNull();
		expect(hit!.osmWayId).toBe(1);
		expect(hit!.s).toBeCloseTo(40, 6);
		expect(hit!.lateral).toBeCloseTo(2, 6);
		expect(hit!.point[0]).toBeCloseTo(40, 6);
		expect(hit!.point[1]).toBeCloseTo(0, 6);
	});

	test("a click between the two roads picks the closer one", () => {
		expect(reg.pick(40, 20, 100)!.osmWayId).toBe(1); // 20 from A, 30 from B
		expect(reg.pick(40, 35, 100)!.osmWayId).toBe(2); // 35 from A, 15 from B
	});

	test("a click farther than maxLateral from every road misses", () => {
		expect(reg.pick(40, 200, 10)).toBeNull();
	});

	test("wayLength sums all loaded segments sharing the id", () => {
		const reg2 = new EditableRoadRegistry();
		// wayId 7 split across two tiles: 0..100 and 100..150 = 150 total.
		reg2.ingestTile("0,0", [{osmWayId: 7, centerline: [[0, 0], [100, 0]]}]);
		reg2.ingestTile("1,0", [{osmWayId: 7, centerline: [[100, 0], [150, 0]]}]);
		const hit = reg2.pick(50, 0, 5);
		expect(hit!.wayLength).toBeCloseTo(150, 6);
		expect(hit!.segmentLength).toBeCloseTo(100, 6); // only the hit segment
	});
});

describe("selection state", () => {
	test("select sets the id, bumps revision, and exposes the selected centerlines", () => {
		const reg = new EditableRoadRegistry();
		reg.ingestTile("0,0", [wayA, wayB]);
		const r0 = reg.revision;
		reg.select(2);
		expect(reg.selectedWayId).toBe(2);
		expect(reg.revision).toBeGreaterThan(r0);
		expect(reg.selectedCenterlines().map(r => r.osmWayId)).toEqual([2]);

		reg.select(null);
		expect(reg.selectedWayId).toBeNull();
		expect(reg.selectedCenterlines()).toEqual([]);
	});

	test("selecting the same id again does not bump the revision", () => {
		const reg = new EditableRoadRegistry();
		reg.select(5);
		const r = reg.revision;
		reg.select(5);
		expect(reg.revision).toBe(r);
	});
});
