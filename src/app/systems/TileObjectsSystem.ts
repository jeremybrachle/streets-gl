import TileSystem from "./TileSystem";
import Tile from "../objects/Tile";
import TileBuilding from "../world/TileBuilding";
import System from "../System";
import {hiddenBuildingsRegistry} from "../world/HiddenBuildingsRegistry";
import {buildingCollisionRegistry, FootprintEntry} from "../collision/BuildingCollisionRegistry";
import {translateAABB, translatePolygon} from "../collision/FootprintCollision";

export default class TileObjectsSystem extends System {
	private buildingsList: Map<number, TileBuilding> = new Map();
	private activeTiles: Set<Tile> = new Set();

	public postInit(): void {

	}

	public addTile(tile: Tile): void {
		this.activeTiles.add(tile);

		for (const packedId of tile.buildingOffsetMap.keys()) {
			const object = this.buildingsList.get(packedId);

			if (object) {
				object.addParent(tile);
			} else {
				const building = new TileBuilding(packedId);
				building.addParent(tile);
				this.buildingsList.set(packedId, building);
			}

			// Strata: re-apply user "delete from view" choices as buildings stream in. addParent made
			// `tile` this building's holder (the tile that renders it), so hide it there.
			if (hiddenBuildingsRegistry.isHidden(packedId) && tile.isBuildingVisible(packedId)) {
				tile.hideBuilding(packedId);
			}
		}

		// Strata physics spike: register this tile's building footprints (translated to world space)
		// for wall collision. Hidden buildings are filtered at query time in the registry.
		const entries: FootprintEntry[] = [];
		for (const [packedId, local] of tile.buildingFootprints) {
			entries.push({
				packedId,
				aabb: translateAABB(local.aabb, tile.position.x, tile.position.z),
				polygon: translatePolygon(local.polygon, tile.position.x, tile.position.z),
			});
		}
		buildingCollisionRegistry.setTile(tile.localId, entries);
	}

	// Strata: hide a building NOW on its current holder tile (instant — patches the display buffer, no
	// re-mesh). Used when the user deletes a building they're looking at. No-op if it isn't loaded.
	public hideBuildingNow(packedId: number): void {
		const building = this.buildingsList.get(packedId);
		if (building && building.holder && building.holder.isBuildingVisible(packedId)) {
			building.holder.hideBuilding(packedId);
		}
	}

	// Strata: re-show a previously hidden building (undo / restore all). No-op if it isn't loaded.
	public showBuildingNow(packedId: number): void {
		const building = this.buildingsList.get(packedId);
		if (building && building.holder && !building.holder.isBuildingVisible(packedId)) {
			building.holder.showBuilding(packedId);
		}
	}

	public removeTile(tile: Tile): void {
		this.activeTiles.delete(tile);
		buildingCollisionRegistry.removeTile(tile.localId);

		if (!tile.buildingOffsetMap) {
			return;
		}

		for (const packedId of tile.buildingOffsetMap.keys()) {
			const object = this.buildingsList.get(packedId);

			if (object) {
				object.removeParent(tile);
			}
		}
	}

	public getTileBuildingByPackedId(id: number): TileBuilding {
		return this.buildingsList.get(id);
	}

	public update(deltaTime: number): void {
		for (const tile of this.systemManager.getSystem(TileSystem).tiles.values()) {
			if (tile.extrudedMesh && !this.activeTiles.has(tile)) {
				this.addTile(tile);
			}
		}
	}
}