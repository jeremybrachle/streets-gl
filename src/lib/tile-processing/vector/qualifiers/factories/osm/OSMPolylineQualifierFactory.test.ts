import OSMPolylineQualifierFactory from "./OSMPolylineQualifierFactory";
import {VectorPolylineDescriptor} from "~/lib/tile-processing/vector/qualifiers/descriptors";
import {QualifierType} from "~/lib/tile-processing/vector/qualifiers/Qualifier";

const factory = new OSMPolylineQualifierFactory();

// Pull the primary path descriptor (the roadway itself) out of the qualifier list the factory emits.
function roadDescriptor(tags: Record<string, string>): VectorPolylineDescriptor {
	const qualifiers = factory.fromTags(tags);
	const first = qualifiers[0];

	expect(first.type).toBe(QualifierType.Descriptor);

	return first.data as VectorPolylineDescriptor;
}

describe("OSMPolylineQualifierFactory bridge tagging", () => {
	test("flags a bridge=yes roadway and reads its layer", () => {
		const d = roadDescriptor({highway: "motorway", bridge: "yes", layer: "1"});

		expect(d.pathType).toBe("roadway");
		expect(d.isBridge).toBe(true);
		expect(d.bridgeLayer).toBe(1);
	});

	test("flags non-'yes' bridge values (e.g. viaduct) as a bridge", () => {
		const d = roadDescriptor({highway: "motorway", bridge: "viaduct", layer: "2"});

		expect(d.isBridge).toBe(true);
		expect(d.bridgeLayer).toBe(2);
	});

	test("a bridge with no layer tag leaves bridgeLayer undefined", () => {
		const d = roadDescriptor({highway: "residential", bridge: "yes"});

		expect(d.isBridge).toBe(true);
		expect(d.bridgeLayer).toBeUndefined();
	});

	test("a normal ground road is not a bridge", () => {
		const d = roadDescriptor({highway: "residential"});

		expect(d.isBridge).toBeUndefined();
		expect(d.bridgeLayer).toBeUndefined();
	});

	test("bridge=no is treated as a ground road", () => {
		const d = roadDescriptor({highway: "residential", bridge: "no"});

		expect(d.isBridge).toBeUndefined();
	});
});
