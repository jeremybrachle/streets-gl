import Vec2 from "~/lib/math/Vec2";

// Strata Lane B — road-proximity culling. OSM forest/wood polygons don't subtract the roads that
// cross them, so the engine's Poisson tree scatter drops trees right in the middle of roads. This
// pure helper removes scattered instances that fall within a clearance of the nearest road
// centerline. The "nearest road" query is injected (the engine's RoadGraph.getClosestProjection in
// production, a plain function in tests), keeping this unit-testable with no engine dependency.

// Returns the nearest point on any road to `point` (in the same 2D space as the instances), or null
// when there is no road nearby. Mirrors RoadGraph.getClosestProjection's contract.
export type NearestRoadFn = (point: Vec2) => Vec2 | null;

// Minimal positional view of a scattered instance: its 2D footprint is (x, z) (y is height).
export interface PlanarInstance {
	x: number;
	z: number;
}

/**
 * Drop any instance whose 2D position lies strictly within `clearance` of the nearest road
 * centerline. Instances with no road nearby (projection null) are kept, as are instances exactly at
 * the clearance distance (boundary kept). Returns a new array; the input is not mutated.
 */
export function cullInstancesNearRoads<T extends PlanarInstance>(
	instances: T[],
	nearestRoad: NearestRoadFn,
	clearance: number
): T[] {
	if (clearance <= 0) {
		return instances;
	}

	return instances.filter(instance => {
		const point = new Vec2(instance.x, instance.z);
		const projection = nearestRoad(point);

		if (projection === null) {
			return true;
		}

		return Vec2.distance(point, projection) >= clearance;
	});
}
