import Vec2 from "~/lib/math/Vec2";
import Tile from "../objects/Tile";
import System from "../System";
import CursorStyleSystem from "./CursorStyleSystem";
import TileSystem from "./TileSystem";
import UISystem from "./UISystem";
import TileObjectsSystem from "./TileObjectsSystem";
import TileBuilding from "../world/TileBuilding";
import ControlsSystem from "./ControlsSystem";
import Config from "../Config";
import {editableRoadRegistry} from "~/app/roadcompiler/EditableRoadRegistry";

// Strata Checkpoint ③ — how close (m, lateral) a click must land to a road centerline to select it.
// Generous so a road is easy to hit from the orbit camera; portable (no per-road width assumed yet).
const RoadPickMaxLateral = 25;

export default class PickingSystem extends System {
	private enablePicking: boolean = true;
	private hoveredObjectId: number = 0;
	private selectedObjectId: number = 0;
	private pointerDownPosition: Vec2 = new Vec2();
	public selectedTileBuilding: TileBuilding = null;
	public pointerPosition: Vec2 = new Vec2();

	public constructor() {
		super();

		const canvas = document.getElementById('canvas');

		canvas.addEventListener('pointerdown', e => {
			if (e.button !== 0) {
				return;
			}

			this.updatePointerPositionFromEvent(e, true);
		});

		canvas.addEventListener('pointermove', e => {
			this.updatePointerPositionFromEvent(e);
		});

		canvas.addEventListener('pointerup', e => {
			if (e.button !== 0) {
				return;
			}

			this.updatePointerPositionFromEvent(e);

			if (this.pointerDownPosition.x === this.pointerPosition.x && this.pointerDownPosition.y === this.pointerPosition.y) {
				this.onClick();
			}
		});

		canvas.addEventListener('mouseenter', e => {
			this.enablePicking = true;
		});

		canvas.addEventListener('mouseleave', e => {
			this.enablePicking = false;
		});
	}

	public postInit(): void {

	}

	private updatePointerPositionFromEvent(e: PointerEvent, updatePointerDown: boolean = false): void {
		if (document.pointerLockElement !== null) {
			this.pointerPosition.x = Math.floor(window.innerWidth / 2);
			this.pointerPosition.y = Math.floor(window.innerHeight / 2);
		} else {
			this.pointerPosition.x = e.clientX;
			this.pointerPosition.y = e.clientY;
		}

		if (updatePointerDown) {
			this.pointerDownPosition.x = this.pointerPosition.x;
			this.pointerDownPosition.y = this.pointerPosition.y;
		}
	}

	public readObjectId(buffer: Uint32Array): void {
		this.hoveredObjectId = buffer[0];
		this.updatePointer();
	}

	public clearHoveredObjectId(): void {
		this.hoveredObjectId = 0;
		this.updatePointer();
	}

	private updatePointer(): void {
		if (this.hoveredObjectId > 0 && this.enablePicking) {
			this.systemManager.getSystem(CursorStyleSystem).enablePointer();
		} else {
			this.systemManager.getSystem(CursorStyleSystem).disablePointer();
		}
	}

	private onClick(): void {
		// Strata Checkpoint ③ — roads aren't GPU-pickable (the object-id buffer is buildings only), so
		// when the click doesn't land on a building, project it to the ground and pick the nearest
		// editable road centerline on the CPU. Editing only happens in the flyover/orbit view (where the
		// projection is valid): there a road hit selects it and an empty click clears the selection. In
		// drive/free/slippy the projection is unavailable, so we leave the road selection untouched (a
		// click while drive-testing must not clear it) and fall through to normal building picking.
		if (Config.EditableRoadEditing && this.hoveredObjectId === 0) {
			if (this.tryEditRoad()) {
				this.clearSelection(); // a road was selected/deselected — drop any building selection
				return;
			}
		}

		if (this.hoveredObjectId === 0 || this.hoveredObjectId === this.selectedObjectId) {
			this.clearSelection();
			return;
		}

		if (this.hoveredObjectId !== 0) {
			// Selecting a building clears any road selection (the two are mutually exclusive).
			if (Config.EditableRoadEditing) {
				editableRoadRegistry.select(null);
			}

			this.selectedObjectId = this.hoveredObjectId;

			const selectedValue = this.selectedObjectId - 1;

			const localTileId = selectedValue >> 16;
			const tile = this.systemManager.getSystem(TileSystem).getTileByLocalId(localTileId);
			const localFeatureId = selectedValue & 0xffff;
			const packedFeatureId = tile.buildingLocalToPackedMap.get(localFeatureId);

			const [type, id] = Tile.unpackFeatureId(packedFeatureId);

			const tileObjectsSystem = this.systemManager.getSystem(TileObjectsSystem);
			this.selectedTileBuilding = tileObjectsSystem.getTileBuildingByPackedId(packedFeatureId);

			this.systemManager.getSystem(UISystem).setActiveFeature(type, id);
		}
	}

	// Handle a road-editor click: project it to the ground and set the road selection (a hit selects the
	// way, an empty click clears it). Returns true if it handled the click — i.e. we're in the
	// flyover/orbit view where the projection is valid. Returns false (selection untouched) in
	// drive/free/slippy, so the caller falls through to normal building picking.
	private tryEditRoad(): boolean {
		const ground = this.systemManager.getSystem(ControlsSystem)
			.screenToGround(this.pointerPosition.x, this.pointerPosition.y);

		if (!ground) {
			return false;
		}

		const pick = editableRoadRegistry.pick(ground.x, ground.y, RoadPickMaxLateral);
		editableRoadRegistry.select(pick ? pick.osmWayId : null);
		return true;
	}

	public clearSelection(): void {
		this.selectedObjectId = 0;
		this.selectedTileBuilding = null;
		this.systemManager.getSystem(UISystem).clearActiveFeature();
	}

	public update(deltaTime: number): void {

	}
}