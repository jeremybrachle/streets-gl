import React, {useEffect, useState} from "react";
import styles from './RoadEditorPanel.scss';
import {editableRoadRegistry} from "~/app/roadcompiler/EditableRoadRegistry";
import {roadHeightEditRegistry} from "~/app/roadcompiler/RoadHeightEditRegistry";
import DraggablePanel from "~/app/ui/components/DraggablePanel";
import {NumberField} from "~/app/ui/components/BridgePanel/BridgePanel";
import Config from "~/app/Config";

// Default height (world units) a way is first lifted to when you start editing it. Most SF bridges sit
// over water near sea level, so this reads as a clear lift; the slider + exact-entry box tune from here.
const DefaultEditHeight = 40;

// Strata Checkpoint ③ — the dedicated road-height editor menu. Split out of the dev panel (BridgePanel)
// so it's its OWN draggable/minimizable panel, visible in EVERY mode: you click-select roads in the
// orbit/flyover view (the primary edit location) and the same panel stays up while you drive-test the
// edit. It reads editableRoadRegistry (the singleton the CPU click-pick writes) and shows the selected
// way id + length; later steps add the height controls + Print/export here.
//
// Selection is set OUTSIDE React (PickingSystem's click-pick), so we reflect it by polling the
// registry's revision counter each animation frame and re-rendering only when it actually changes.
const RoadEditorPanel: React.FC = () => {
	const [, bump] = useState(0);
	const rerender = (): void => bump(n => n + 1);

	useEffect(() => {
		let raf = 0;
		let last = editableRoadRegistry.revision;
		let lastHeight = roadHeightEditRegistry.revision;
		const tick = (): void => {
			if (editableRoadRegistry.revision !== last || roadHeightEditRegistry.revision !== lastHeight) {
				last = editableRoadRegistry.revision;
				lastHeight = roadHeightEditRegistry.revision;
				rerender();
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, []);

	if (!Config.EditableRoadEditing) {
		return null;
	}

	const selectedWayId = editableRoadRegistry.selectedWayId;
	const editedHeight = selectedWayId !== null ? roadHeightEditRegistry.heightFor(selectedWayId) : null;
	// Slider/box value: the live edited height, or the default lift before the way is raised.
	const heightValue = editedHeight ?? DefaultEditHeight;

	const setHeight = (v: number): void => {
		if (selectedWayId !== null) {
			roadHeightEditRegistry.setHeight(selectedWayId, v);
			rerender();
		}
	};

	return (
		<DraggablePanel prefId="roadEditor" title="Road editor" defaultStyle={{top: 70, right: 16}} bare>
			<div className={styles.roadEditor}>
				{selectedWayId !== null ? (
					<>
						<div className={styles['roadEditor__row']}>
							<span>Selected way <strong>{selectedWayId}</strong></span>
						</div>
						<div className={styles['roadEditor__row']}>
							<span>Length {editableRoadRegistry.wayLength(selectedWayId).toFixed(0)} m</span>
						</div>
						<label className={styles['roadEditor__row']}>
							<span className={styles['roadEditor__label']}>Height</span>
							<input
								type="range"
								min={-20}
								max={150}
								step={1}
								value={heightValue}
								onChange={(e): void => setHeight(parseFloat(e.target.value))}
							/>
							<NumberField
								value={heightValue}
								digits={0}
								step={1}
								onCommit={setHeight}
							/>
						</label>
						<div className={styles['roadEditor__buttons']}>
							{editedHeight !== null && (
								<button
									type="button"
									onClick={(): void => {
										roadHeightEditRegistry.clearHeight(selectedWayId);
										rerender();
									}}
								>
									Reset height
								</button>
							)}
							<button
								type="button"
								onClick={(): void => {
									editableRoadRegistry.select(null);
									rerender();
								}}
							>
								Clear selection
							</button>
						</div>
					</>
				) : (
					<div className={`${styles['roadEditor__row']} ${styles['roadEditor__hint']}`}>
						<span>Click a road (flyover view) to select it</span>
					</div>
				)}
			</div>
		</DraggablePanel>
	);
};

export default RoadEditorPanel;
