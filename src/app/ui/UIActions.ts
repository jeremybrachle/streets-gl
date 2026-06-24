import {OverpassEndpoint} from "~/app/systems/TileLoadingSystem";

export default interface UIActions {
	updateRenderGraph: () => void;
	goToLatLon: (lat: number, lon: number) => void;
	goToState: (lat: number, lon: number, pitch: number, yaw: number, distance: number) => void;
	lookAtNorth: () => void;
	setTime: (time: number) => void;
	resetSettings: () => void;
	setOverpassEndpoints: (endpoints: OverpassEndpoint[]) => void;
	resetOverpassEndpoints: () => void;
	getControlsStateHash: () => string;
	// Strata "delete from view": hide the selected building, undo the last hide, restore all.
	hideActiveBuilding: () => void;
	undoLastHide: () => void;
	restoreAllHidden: () => void;
}