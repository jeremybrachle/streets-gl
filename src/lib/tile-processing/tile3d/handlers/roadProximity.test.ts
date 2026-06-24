import Vec2 from "~/lib/math/Vec2";
import {cullInstancesNearRoads, NearestRoadFn, PlanarInstance} from "./roadProximity";

// A fake road running along the x-axis: the nearest point to (x, z) is (x, 0), so the distance to
// the road is simply |z|. This makes the clearance behaviour trivial to assert.
const roadOnXAxis: NearestRoadFn = (p: Vec2): Vec2 => new Vec2(p.x, 0);

const at = (x: number, z: number): PlanarInstance => ({x, z});

describe("cullInstancesNearRoads", () => {
	test("drops instances within the clearance of the road", () => {
		const kept = cullInstancesNearRoads([at(0, 1), at(10, 2)], roadOnXAxis, 5);
		expect(kept).toHaveLength(0);
	});

	test("keeps instances beyond the clearance", () => {
		const kept = cullInstancesNearRoads([at(0, 6), at(10, 100)], roadOnXAxis, 5);
		expect(kept).toHaveLength(2);
	});

	test("keeps an instance exactly at the clearance distance (boundary inclusive)", () => {
		const kept = cullInstancesNearRoads([at(0, 5)], roadOnXAxis, 5);
		expect(kept).toHaveLength(1);
	});

	test("filters a mixed array, keeping only the far ones", () => {
		const kept = cullInstancesNearRoads(
			[at(0, 1), at(0, 8), at(50, 3), at(50, 20)],
			roadOnXAxis,
			5
		);
		expect(kept).toEqual([at(0, 8), at(50, 20)]);
	});

	test("keeps everything when there is no road nearby (projection null)", () => {
		const noRoad: NearestRoadFn = (): null => null;
		const input = [at(0, 0), at(1, 1)];
		expect(cullInstancesNearRoads(input, noRoad, 5)).toEqual(input);
	});

	test("a non-positive clearance is a no-op (returns the input array)", () => {
		const input = [at(0, 0), at(1, 1)];
		expect(cullInstancesNearRoads(input, roadOnXAxis, 0)).toBe(input);
		expect(cullInstancesNearRoads(input, roadOnXAxis, -1)).toBe(input);
	});

	test("does not mutate the input array", () => {
		const input = [at(0, 1), at(0, 100)];
		const copy = [...input];
		cullInstancesNearRoads(input, roadOnXAxis, 5);
		expect(input).toEqual(copy);
	});

	test("empty input yields empty output", () => {
		expect(cullInstancesNearRoads([], roadOnXAxis, 5)).toEqual([]);
	});
});
