import Tile3DFeature from "~/lib/tile-processing/tile3d/features/Tile3DFeature";
import RoadGraph from "~/lib/road-graph/RoadGraph";

export interface RequestedHeightParams {
	positions: Float64Array;
	callback: (heights: Float64Array) => void;
}

export default interface Handler {
	setRoadGraph(graph: RoadGraph): void;
	setMercatorScale(scale: number): void;
	// Strata Lane B — the handler's own tile index, used by the handlers that run geometric corridor
	// ghost-suppression (frame D -> E needs it). Optional: node/powerline handlers don't implement it.
	setTileCoords?(x: number, y: number, zoom: number): void;
	getFeatures(): Tile3DFeature[];
	getRequestedHeightPositions(): RequestedHeightParams;
}