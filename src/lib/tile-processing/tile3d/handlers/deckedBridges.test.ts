import {isDeckedBridgeWay} from "./deckedBridges";
import {OSMReferenceType} from "~/lib/tile-processing/vector/features/OSMReference";

const decked = new Set<number>([42]);
const way = (id: number) => ({type: OSMReferenceType.Way, id});

describe("isDeckedBridgeWay", () => {
	test("matches a way whose id has a deck (suppress its line/area geometry)", () => {
		expect(isDeckedBridgeWay(way(42), decked)).toBe(true);
	});

	test("does not match a way with no registered deck", () => {
		expect(isDeckedBridgeWay(way(7), decked)).toBe(false);
	});

	test("matches purely by id — no bridge tag needed (PBF tiles carry none)", () => {
		expect(isDeckedBridgeWay(way(42), decked)).toBe(true);
	});

	test("ignores non-way references (relations / nodes / null)", () => {
		expect(isDeckedBridgeWay({type: OSMReferenceType.Relation, id: 42}, decked)).toBe(false);
		expect(isDeckedBridgeWay({type: OSMReferenceType.Node, id: 42}, decked)).toBe(false);
		expect(isDeckedBridgeWay(null, decked)).toBe(false);
	});
});
