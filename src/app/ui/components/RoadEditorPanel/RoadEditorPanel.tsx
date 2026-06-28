import React, {useEffect, useState} from "react";
import styles from './RoadEditorPanel.scss';
import {editableRoadRegistry} from "~/app/roadcompiler/EditableRoadRegistry";
import DraggablePanel from "~/app/ui/components/DraggablePanel";
import Config from "~/app/Config";

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
		const tick = (): void => {
			if (editableRoadRegistry.revision !== last) {
				last = editableRoadRegistry.revision;
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
						<div className={styles['roadEditor__buttons']}>
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
