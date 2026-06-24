import React, {useContext} from "react";
import {useRecoilValue} from "recoil";
import styles from "./HiddenBuildingsPanel.scss";
import {ActionsContext, AtomsContext} from "~/app/ui/UI";

// Strata "delete from view" — a small always-available control for the buildings the user has hidden
// by clicking them + pressing "Hide from view". Shows only when something is hidden; lets you undo the
// last hide or restore everything. The hidden set itself is persisted (HiddenBuildingsRegistry), so
// this just reflects the live count and routes the undo/restore actions into the systems.
const HiddenBuildingsPanel: React.FC = () => {
	const atoms = useContext(AtomsContext);
	const actions = useContext(ActionsContext);
	const count = useRecoilValue(atoms.hiddenBuildingsCount);

	if (!count) {
		return null;
	}

	return (
		<div className={styles.hiddenBuildings}>
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
	);
};

export default HiddenBuildingsPanel;
