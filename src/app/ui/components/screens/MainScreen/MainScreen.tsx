import React, {useCallback, useContext, useEffect, useState} from "react";
import LegalAttributionPanel from "~/app/ui/components/LegalAttributionPanel";
import {useRecoilValue} from "recoil";
import DebugInfo from "~/app/ui/components/DebugInfo";
import CompassPanel from "~/app/ui/components/CompassPanel";
import SelectionPanel from "~/app/ui/components/SelectionPanel";
import {ActionsContext, AtomsContext} from "~/app/ui/UI";
import RenderGraphViewer from "~/app/ui/components/RenderGraphViewer";
import SearchPanel from "~/app/ui/components/SearchPanel";
import TimePanel from "~/app/ui/components/TimePanel";
import NavPanel from "~/app/ui/components/NavPanel";
import InfoModalPanel from "~/app/ui/components/InfoModalPanel";
import SettingsModalPanel from "~/app/ui/components/SettingsModalPanel";
import GeolocationButton from "~/app/ui/components/GeolocationButton";
import styles from './MainScreen.scss';
import SavedPlacesModalPanel from "~/app/ui/components/SavedPlacesModalPanel";
import DataTimestamp from "~/app/ui/components/DataTimestamp";
import Speedometer from "~/app/ui/components/Speedometer";
import BridgePanel from "~/app/ui/components/BridgePanel";
import RoadEditorPanel from "~/app/ui/components/RoadEditorPanel";
import RoadGraphOverlayStatus from "~/app/ui/components/RoadGraphOverlayStatus";
import Minimap from "~/app/ui/components/Minimap";
import FullscreenMap from "~/app/ui/components/FullscreenMap";
import HiddenBuildingsPanel from "~/app/ui/components/HiddenBuildingsPanel";
import Config from "~/app/Config";
import {roadGraphOverlay} from "~/app/roadcompiler/RoadGraphOverlayRegistry";
import {routeRegistry} from "~/app/roadcompiler/RouteRegistry";

const MainScreen: React.FC = () => {
	const atoms = useContext(AtomsContext);
	const actions = useContext(ActionsContext);

	const [isRenderGraphVisible, setIsRenderGraphVisible] = useState<boolean>(false);
	const loadingProgress = useRecoilValue(atoms.resourcesLoadingProgress);
	const driveActive = useRecoilValue(atoms.driveActive);
	const [activeModalWindow, setActiveModalWindow] = useState<string>('');
	const [isUIVisible, setIsUIVisible] = useState<boolean>(true);
	// Strata GPS — the full-screen "magnify" map, opened by clicking the minimap.
	const [mapExpanded, setMapExpanded] = useState<boolean>(false);

	const showRenderGraph = useCallback((): void => setIsRenderGraphVisible(true), []);
	const hideRenderGraph = useCallback((): void => setIsRenderGraphVisible(false), []);

	const closeModal = useCallback((): void => setActiveModalWindow(''), []);

	useEffect(() => {
		const handler = (e: KeyboardEvent): void => {
			if (e.code === 'KeyU' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				setIsUIVisible(!isUIVisible);
			}

			if (e.code === 'Escape') {
				closeModal();
			}

			// Strata P2/P2.5 — KeyO toggles the road-graph alignment overlay. The load is kicked from the
			// render pass using the live camera position: a bundled city (SF) loads instantly, any other is
			// fetched from Overpass on demand and cached.
			if (e.code === 'KeyO' && Config.RoadGraphOverlay) {
				roadGraphOverlay.toggleVisible();
			}

			// Strata GPS — KeyP toggles the yellow active-route ribbon in the 3D world, independently of the
			// KeyO all-roads overlay. (Pick the destination on the full-screen map, opened from the minimap.)
			if (e.code === 'KeyP' && Config.RoadGraphOverlay) {
				routeRegistry.toggleVisible();
			}
		}

		window.addEventListener('keydown', handler);
		return () => {
			window.removeEventListener('keydown', handler)
		};
	}, [isUIVisible]);

	let containerClassNames = styles.mainScreen;

	if (!isUIVisible || loadingProgress < 1.) {
		containerClassNames += ' ' + styles['mainScreen--hidden'];
	}

	return (
		<div className={containerClassNames}>
			<SearchPanel/>
			<NavPanel
				setActiveModalWindow={setActiveModalWindow}
				activeModalWindow={activeModalWindow}
			/>
			{
				activeModalWindow === 'info' && <InfoModalPanel onClose={closeModal}/>
			}
			{
				activeModalWindow === 'settings' && <SettingsModalPanel onClose={closeModal}/>
			}
			{
				activeModalWindow === 'savedPlaces' && <SavedPlacesModalPanel onClose={closeModal}/>
			}
			{!driveActive && <DebugInfo showRenderGraph={showRenderGraph}/>}
			{driveActive && <BridgePanel/>}
			{/* The road-height editor is its own menu, visible in EVERY mode: click-select roads in the
			    flyover view, keep it up while drive-testing. Self-gates on Config.EditableRoadEditing. */}
			<RoadEditorPanel/>
			{/* P2.5 — "Loading road graph…" indicator while an un-bundled city's OSM graph fetches. */}
			<RoadGraphOverlayStatus/>
			<Speedometer/>
			{/* s28 — GTA-style 2D minimap; self-gates on driveActive (only visible while driving).
			    Clicking it opens the full-screen "magnify" map where you pick a GPS destination. */}
			<Minimap onExpand={(): void => setMapExpanded(true)}/>
			{driveActive && mapExpanded && <FullscreenMap onClose={(): void => setMapExpanded(false)}/>}
			<DataTimestamp/>
			<TimePanel/>
			<SelectionPanel/>
			<HiddenBuildingsPanel/>
			<LegalAttributionPanel/>
			<CompassPanel/>
			<GeolocationButton/>
			{
				isRenderGraphVisible && (
					<RenderGraphViewer
						update={actions.updateRenderGraph}
						close={hideRenderGraph}
					/>
				)
			}
		</div>
	);
}

export default MainScreen;
