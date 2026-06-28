import {SettingsSchema, SettingsSchemaRangeScale} from "~/app/settings/SettingsSchema";

const Config = {
	TileSize: /*40075016.68 / (1 << 16)*/ 611.4962158203125,
	MaxConcurrentTiles: 150,
	MaxTilesPerWorker: 1,
	WorkersCount: Math.min(4, navigator.hardwareConcurrency),
	StartPosition: {lat: 37.8199, lon: -122.4783, pitch: 45, yaw: 0, distance: 2000}, // Golden Gate Bridge (Strata)
	MinCameraDistance: 10,
	MaxCameraDistance: 4000,
	SlippyMapTransitionDuration: 400,
	MinFreeCameraHeight: 10,
	CameraZoomSmoothing: 0.4,
	CameraZoomSpeed: 0.0005,
	CameraZoomTrackpadFactor: 4,
	MinCameraPitch: 5,
	MaxCameraPitch: 89.99,
	MinFreeCameraPitch: -89.99,
	MaxFreeCameraPitch: 89.99,
	GroundCameraSpeed: 400,
	GroundCameraSpeedFast: 1200,
	FreeCameraSpeed: 400,
	FreeCameraSpeedFast: 1200,
	FreeCameraRotationSensitivity: 0.00002,
	FreeCameraYawSpeed: 0.8,
	FreeCameraPitchSpeed: 0.8,
	MinTexturedRoofArea: 50,
	MaxTexturedRoofAABBArea: 2e6,
	BuildingSmoothNormalsThreshold: 30,
	LightTransitionDuration: 1,
	OverpassRequestTimeout: 30000,
	CameraFOVZoomFactor: 2,
	CSMShadowCameraNear: 1,
	CSMShadowCameraFar: 20000,
	TerrainRingCount: 6,
	TerrainRingSegmentCount: 64,
	TerrainRingSizeZoom: 13,
	TerrainRingSize: 40075016.68 / (1 << 13),
	TerrainMaskResolution: 32,
	TerrainNormalMixRange: [10000, 14500],
	TerrainUsageTextureSize: 512,
	TerrainUsageTexturePadding: 3,
	TerrainUsageSDFPasses: 3,
	TerrainDetailUVScale: 64,
	SlippyMapMinZoom: 0,
	SlippyMapMaxZoom: 16,
	SlippyMapZoomFactor: 0.001,
	SlippyMapFetchBatchSize: 4,
	// DEBUG (Checkpoint ②): render bridge/elevated roadways with a loud stand-in texture so tagged ways
	// are visually obvious against ground roads. Throwaway diagnostic — toggle off to restore normal
	// road textures. (True magenta needs a dedicated atlas texture; this reuses an existing one.)
	DebugHighlightBridges: true,
	// DEBUG (Checkpoint ③, step 2a): log each tile's editable bridge centerlines as they reach the
	// main-thread EditableRoadRegistry, plus the running total — a console proof that the worker→main
	// centerline plumbing works before the click-pick UI lands. Throwaway diagnostic.
	DebugLogEditableRoads: true,
	// Checkpoint ③, step 2b: enable the road-height editor's CPU click-pick + selection highlight. In
	// the orbit/map view (Ground mode) a click that doesn't hit a building projects to the ground and
	// selects the nearest editable road centerline; the selection is shown in the road-editor panel and
	// drawn as a highlight ribbon. Master gate for the editor interactions (off = stock building picking).
	EditableRoadEditing: true,
	// Live terrain base-texture switcher (s12). Parked for now (only one area can be edited and it
	// distracts from the road editor) — off = the engine keeps its default ground (the pre-switcher
	// look) and the dev panel hides the texture controls. Re-enable when the click-to-edit terrain
	// workflow lands. When false the registry ignores any persisted override so the default applies.
	TerrainTextureSwitcher: false,
	SettingsSchema: {
		fov: {
			label: 'Vertical field of view',
			selectRange: [5, 120, 1],
			selectRangeDefault: 40,
			category: 'general'
		},
		labels: {
			label: 'Text labels',
			status: ['off', 'on'],
			statusLabels: ['Disabled', 'Enabled'],
			statusDefault: 'on',
			category: 'general'
		},
		terrainHeight: {
			label: 'Use terrain elevation data',
			status: ['off', 'on'],
			statusLabels: ['Disabled', 'Enabled'],
			statusDefault: 'on',
			category: 'general'
		},
		/*airTraffic: {
			label: 'Real-time air traffic',
			status: ['off', 'on'],
			statusLabels: ['Disabled', 'Enabled'],
			statusDefault: 'on',
			category: 'general'
		},*/
		shadows: {
			label: 'Shadows',
			status: ['off', 'low', 'medium', 'high'],
			statusLabels: ['Disabled', 'Low', 'Medium', 'High'],
			statusDefault: 'medium',
			category: 'graphics'
		},
		taa: {
			label: 'TAA',
			status: ['off', 'on'],
			statusLabels: ['Disabled', 'Enabled'],
			statusDefault: 'on',
			category: 'graphics'
		},
		dof: {
			label: 'Depth of field',
			status: ['off', 'low', 'high'],
			statusLabels: ['Disabled', 'Low quality', 'High quality'],
			statusDefault: 'off',
			category: 'graphics'
		},
		dofAperture: {
			label: 'Aperture',
			parent: 'dof',
			parentStatusCondition: ['low', 'high'],
			selectRange: [0.001, 1, 0.001],
			selectRangeDefault: 0.01,
			selectRangeScale: SettingsSchemaRangeScale.Logarithmic,
			category: 'graphics'
		},
		dofMode: {
			label: 'Focusing mode',
			parent: 'dof',
			parentStatusCondition: ['low', 'high'],
			status: ['center', 'cursor'],
			statusLabels: ['Screen center', 'Cursor position'],
			statusDefault: 'center',
			category: 'graphics'
		},
		bloom: {
			label: 'Bloom',
			status: ['off', 'on'],
			statusLabels: ['Disabled', 'Enabled'],
			statusDefault: 'on',
			category: 'graphics'
		},
		ssr: {
			label: 'Screen-space reflections',
			status: ['off', 'low', 'high'],
			statusLabels: ['Disabled', 'Low quality', 'High quality'],
			statusDefault: 'off',
			category: 'graphics'
		},
		ssao: {
			label: 'Screen-space ambient occlusion',
			status: ['off', 'on'],
			statusLabels: ['Disabled', 'Enabled'],
			statusDefault: 'on',
			category: 'graphics'
		}
	} as SettingsSchema,
	OverpassEndpoints: [
		{url: 'https://overpass-api.de/api/interpreter', isEnabled: true},
		{url: 'https://overpass.openstreetmap.ru/cgi/interpreter', isEnabled: false},
		{url: 'https://overpass.kumi.systems/api/interpreter', isEnabled: false}
	],
	TileServerEndpoint: 'https://tiles.streets.gl',
	SlippyEndpointTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
	TilesEndpointTemplate: 'https://tiles.streets.gl/vector/{z}/{x}/{y}'
};

export default Config;
