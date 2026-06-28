import {
	RoadHeightControlPoint,
	RoadHeightEdit,
	createRoadHeightEdit,
	upsertControlPoint,
	removeControlPoint,
	sortControlPoints,
	positionOf,
	sameControlPoint,
	validateControlPoint,
	validateRoadHeightEdit,
	serializeEdits,
	parseEdits,
	ROAD_HEIGHT_EDIT_SCHEMA,
	OSM_ATTRIBUTION,
	NodePositionResolver,
} from "./RoadHeightEdit";

// A trivial resolver standing in for the editor's geometry: node id N sits at fraction N/100.
const resolver: NodePositionResolver = (id: number) => (id >= 0 && id <= 100 ? id / 100 : undefined);

const fracPoint = (fractionAlong: number, z: number, verticalClass: -1 | 0 | 1 = 1): RoadHeightControlPoint =>
	({fractionAlong, z, verticalClass});
const nodePoint = (osmNodeId: number, z: number, verticalClass: -1 | 0 | 1 = 1): RoadHeightControlPoint =>
	({osmNodeId, z, verticalClass});

describe("validateControlPoint — exactly one position key, valid ranges", () => {
	test("a free fraction handle is valid", () => {
		expect(validateControlPoint(fracPoint(0.5, 10))).toBeNull();
	});

	test("a snapped node handle is valid", () => {
		expect(validateControlPoint(nodePoint(42, 10))).toBeNull();
	});

	test("setting BOTH osmNodeId and fractionAlong is rejected", () => {
		expect(validateControlPoint({osmNodeId: 1, fractionAlong: 0.5, z: 0, verticalClass: 0})).toMatch(/exactly one/);
	});

	test("setting NEITHER is rejected", () => {
		expect(validateControlPoint({z: 0, verticalClass: 0})).toMatch(/exactly one/);
	});

	test("fractionAlong out of [0,1] is rejected", () => {
		expect(validateControlPoint(fracPoint(1.5, 0))).toMatch(/\[0, 1\]/);
		expect(validateControlPoint(fracPoint(-0.1, 0))).toMatch(/\[0, 1\]/);
	});

	test("non-finite z is rejected", () => {
		expect(validateControlPoint({fractionAlong: 0.5, z: NaN, verticalClass: 0})).toMatch(/finite/);
	});

	test("verticalClass outside -1/0/1 is rejected", () => {
		expect(validateControlPoint({fractionAlong: 0.5, z: 0, verticalClass: 2 as 1})).toMatch(/verticalClass/);
	});

	test("non-integer osmNodeId is rejected", () => {
		expect(validateControlPoint({osmNodeId: 1.5, z: 0, verticalClass: 0})).toMatch(/integer/);
	});
});

describe("validateRoadHeightEdit", () => {
	test("a well-formed edit passes and reports the offending index on failure", () => {
		expect(validateRoadHeightEdit({osmWayId: 7, points: [fracPoint(0, 1), fracPoint(1, 2)]})).toBeNull();
		const bad = validateRoadHeightEdit({osmWayId: 7, points: [fracPoint(0, 1), fracPoint(2, 2)]});
		expect(bad).toMatch(/points\[1\]/);
	});

	test("non-integer osmWayId is rejected", () => {
		expect(validateRoadHeightEdit({osmWayId: 1.2, points: []})).toMatch(/osmWayId/);
	});
});

describe("positionOf / sameControlPoint", () => {
	test("fraction handle resolves to its fraction; node handle resolves via the resolver", () => {
		expect(positionOf(fracPoint(0.3, 0), resolver)).toBeCloseTo(0.3, 9);
		expect(positionOf(nodePoint(40, 0), resolver)).toBeCloseTo(0.4, 9);
	});

	test("an unknown node resolves to undefined", () => {
		expect(positionOf(nodePoint(999, 0), resolver)).toBeUndefined();
	});

	test("same node id = same handle; different ids differ", () => {
		expect(sameControlPoint(nodePoint(5, 1), nodePoint(5, 99))).toBe(true);
		expect(sameControlPoint(nodePoint(5, 1), nodePoint(6, 1))).toBe(false);
	});

	test("free handles at the same fraction = same handle; a node handle never equals a free handle", () => {
		expect(sameControlPoint(fracPoint(0.5, 1), fracPoint(0.5, 9))).toBe(true);
		expect(sameControlPoint(nodePoint(50, 1), fracPoint(0.5, 1))).toBe(false);
	});
});

describe("sortControlPoints — ascending along the way", () => {
	test("mixed node + free handles sort by resolved position", () => {
		const points = [fracPoint(0.9, 0), nodePoint(10, 0), fracPoint(0.2, 0), nodePoint(70, 0)];
		const sorted = sortControlPoints(points, resolver);
		const positions = sorted.map(p => positionOf(p, resolver));
		expect(positions).toEqual([0.1, 0.2, 0.7, 0.9]);
	});

	test("unresolvable handles are pushed to the end, original order kept", () => {
		const a = nodePoint(999, 0); // unknown
		const b = nodePoint(998, 0); // unknown
		const sorted = sortControlPoints([a, fracPoint(0.5, 0), b], resolver);
		expect(sorted[0].fractionAlong).toBeCloseTo(0.5, 9);
		expect(sorted.slice(1)).toEqual([a, b]);
	});
});

describe("upsert / remove control points (immutable, kept sorted)", () => {
	test("upsert inserts and keeps the list sorted", () => {
		let edit = createRoadHeightEdit(123);
		edit = upsertControlPoint(edit, fracPoint(0.8, 5), resolver);
		edit = upsertControlPoint(edit, fracPoint(0.2, 5), resolver);
		expect(edit.points.map(p => p.fractionAlong)).toEqual([0.2, 0.8]);
	});

	test("upsert replaces a handle at the same identity rather than duplicating", () => {
		let edit = createRoadHeightEdit(1);
		edit = upsertControlPoint(edit, nodePoint(50, 10), resolver);
		edit = upsertControlPoint(edit, nodePoint(50, 42), resolver);
		expect(edit.points).toHaveLength(1);
		expect(edit.points[0].z).toBe(42);
	});

	test("upsert does not mutate the input edit", () => {
		const edit = createRoadHeightEdit(1);
		const next = upsertControlPoint(edit, fracPoint(0.5, 1), resolver);
		expect(edit.points).toHaveLength(0);
		expect(next.points).toHaveLength(1);
	});

	test("remove drops the matching handle and is a no-op otherwise", () => {
		let edit = createRoadHeightEdit(1);
		edit = upsertControlPoint(edit, nodePoint(10, 1), resolver);
		edit = upsertControlPoint(edit, nodePoint(20, 1), resolver);
		edit = removeControlPoint(edit, nodePoint(10, 999));
		expect(edit.points.map(p => p.osmNodeId)).toEqual([20]);
		const same = removeControlPoint(edit, nodePoint(777, 0));
		expect(same.points).toHaveLength(1);
	});
});

describe("serialize / parse — the export round-trip (the Print button's format)", () => {
	const edits: RoadHeightEdit[] = [
		{osmWayId: 280, points: [nodePoint(10, 12.5, 1), fracPoint(0.5, 30, 1), nodePoint(90, 8, 0)]},
		{osmWayId: 101, points: [fracPoint(0, -4, -1), fracPoint(1, -4, -1)]},
	];

	test("round-trips through serialize -> parse unchanged", () => {
		expect(parseEdits(serializeEdits(edits))).toEqual(edits);
	});

	test("the envelope carries the schema version and OSM attribution (ODbL §5)", () => {
		const env = JSON.parse(serializeEdits(edits));
		expect(env.schema).toBe(ROAD_HEIGHT_EDIT_SCHEMA);
		expect(env.attribution).toBe(OSM_ATTRIBUTION);
	});

	test("parse rejects an unknown / missing schema", () => {
		expect(() => parseEdits(JSON.stringify({edits: []}))).toThrow(/schema/);
		expect(() => parseEdits(JSON.stringify({schema: "bogus", edits: []}))).toThrow(/schema/);
	});

	test("parse rejects a batch containing an invalid edit (fails loud, drops nothing)", () => {
		const bad = JSON.stringify({
			schema: ROAD_HEIGHT_EDIT_SCHEMA,
			attribution: OSM_ATTRIBUTION,
			edits: [{osmWayId: 5, points: [{z: 0, verticalClass: 0}]}],
		});
		expect(() => parseEdits(bad)).toThrow(/way 5/);
	});
});
