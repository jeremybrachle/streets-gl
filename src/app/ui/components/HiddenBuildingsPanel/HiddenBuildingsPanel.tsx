import React, {useContext} from "react";
import {useRecoilValue} from "recoil";
import styles from "./HiddenBuildingsPanel.scss";
import {ActionsContext, AtomsContext} from "~/app/ui/UI";
import Tile from "~/app/objects/Tile";
import DraggablePanel from "~/app/ui/components/DraggablePanel";

// Strata "delete from view" — the menu for buildings the user has hidden by clicking them + pressing
// "Hide from view". Shows only when something is hidden; lists each hidden building with its own "Show"
// button (per-item restore), plus Undo (most recent) and Restore all. Wrapped in DraggablePanel so the
// user can drag it off center-screen or collapse it (position + collapsed state persist). The hidden
// set itself is persisted (HiddenBuildingsRegistry); this reflects the live list and routes actions.
const OSM_TYPE_LABEL = ['Node', 'Way', 'Relation'];

const HiddenBuildingsPanel: React.FC = () => {
	const atoms = useContext(AtomsContext);
	const actions = useContext(ActionsContext);
	const count = useRecoilValue(atoms.hiddenBuildingsCount);
	const list = useRecoilValue(atoms.hiddenBuildingsList);

	if (!count) {
		return null;
	}

	return (
		<DraggablePanel
			prefId="hiddenBuildings"
			title="Hidden buildings"
			defaultStyle={{top: 70, left: '50%', transform: 'translateX(-50%)'}}
		>
			<div className={styles.hiddenBuildings}>
				<div className={styles.hiddenBuildings__header}>
					<span className={styles.hiddenBuildings__label}>
						{count} building{count === 1 ? '' : 's'} hidden
					</span>
					<button
						type="button"
						className={styles.hiddenBuildings__button}
						onClick={(): void => actions.undoLastHide()}
					>
						Undo
					</button>
					<button
						type="button"
						className={styles.hiddenBuildings__button}
						onClick={(): void => actions.restoreAllHidden()}
					>
						Restore all
					</button>
				</div>
				<ul className={styles.hiddenBuildings__list}>
					{list.map(packedId => {
						const [type, id] = Tile.unpackFeatureId(packedId);
						return (
							<li key={packedId} className={styles.hiddenBuildings__item}>
								<span className={styles.hiddenBuildings__itemLabel}>
									{OSM_TYPE_LABEL[type] ?? 'Feature'} {id}
								</span>
								<button
									type="button"
									className={styles.hiddenBuildings__button}
									onClick={(): void => actions.showHidden(packedId)}
								>
									Show
								</button>
							</li>
						);
					})}
				</ul>
			</div>
		</DraggablePanel>
	);
};

export default HiddenBuildingsPanel;
