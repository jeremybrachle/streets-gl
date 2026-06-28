import {RoadHeightEditRegistry} from "./RoadHeightEditRegistry";

describe("RoadHeightEditRegistry", () => {
	test("setHeight stores a single midpoint control point at class +1 and bumps revision", () => {
		const reg = new RoadHeightEditRegistry();
		const r0 = reg.revision;
		reg.setHeight(42, 67);

		expect(reg.heightFor(42)).toBe(67);
		expect(reg.isEdited(42)).toBe(true);
		expect(reg.revision).toBeGreaterThan(r0);

		const edit = reg.allEdits()[0];
		expect(edit.osmWayId).toBe(42);
		expect(edit.points).toHaveLength(1);
		expect(edit.points[0]).toEqual({fractionAlong: 0.5, z: 67, verticalClass: 1});
	});

	test("heightFor / isEdited are null/false for an unedited way", () => {
		const reg = new RoadHeightEditRegistry();
		expect(reg.heightFor(99)).toBeNull();
		expect(reg.isEdited(99)).toBe(false);
	});

	test("re-setting a height replaces the single point (no stacking) and bumps revision", () => {
		const reg = new RoadHeightEditRegistry();
		reg.setHeight(1, 10);
		reg.setHeight(1, 20);
		expect(reg.heightFor(1)).toBe(20);
		expect(reg.allEdits()[0].points).toHaveLength(1);
	});

	test("clearHeight removes the edit and bumps revision", () => {
		const reg = new RoadHeightEditRegistry();
		reg.setHeight(1, 10);
		const r = reg.revision;
		reg.clearHeight(1);
		expect(reg.isEdited(1)).toBe(false);
		expect(reg.heightFor(1)).toBeNull();
		expect(reg.revision).toBeGreaterThan(r);
	});

	test("editedWayIds lists every edited way", () => {
		const reg = new RoadHeightEditRegistry();
		reg.setHeight(1, 10);
		reg.setHeight(2, 20);
		expect(reg.editedWayIds().sort()).toEqual([1, 2]);
	});

	describe("onEditedWaysChanged fires only on SET MEMBERSHIP change", () => {
		test("a newly-edited way notifies with the full set + the changed id", () => {
			const reg = new RoadHeightEditRegistry();
			const calls: {ids: number[]; changed: number}[] = [];
			reg.onEditedWaysChanged = (ids, changed): void => {
				calls.push({ids: [...ids].sort(), changed});
			};

			reg.setHeight(7, 30);
			reg.setHeight(8, 40);
			expect(calls).toEqual([
				{ids: [7], changed: 7},
				{ids: [7, 8], changed: 8},
			]);
		});

		test("changing the value of an already-edited way does NOT notify (no re-decode storm)", () => {
			const reg = new RoadHeightEditRegistry();
			let count = 0;
			reg.onEditedWaysChanged = (): void => {
				count++;
			};

			reg.setHeight(7, 30);
			expect(count).toBe(1);
			reg.setHeight(7, 31);
			reg.setHeight(7, 32);
			expect(count).toBe(1); // value tweaks don't change membership
		});

		test("clearing a way notifies with the updated set", () => {
			const reg = new RoadHeightEditRegistry();
			const calls: {ids: number[]; changed: number}[] = [];
			reg.setHeight(7, 30);
			reg.setHeight(8, 40);
			reg.onEditedWaysChanged = (ids, changed): void => {
				calls.push({ids: [...ids].sort(), changed});
			};

			reg.clearHeight(7);
			expect(calls).toEqual([{ids: [8], changed: 7}]);
		});

		test("clearing an unedited way does not notify", () => {
			const reg = new RoadHeightEditRegistry();
			let count = 0;
			reg.onEditedWaysChanged = (): void => {
				count++;
			};
			reg.clearHeight(123);
			expect(count).toBe(0);
		});
	});
});
