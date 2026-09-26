import { vacuumModel } from "./vacuumRobot.js";
import { forkliftModel } from "./forkliftRobot.js";
import { truckModel } from "./truckRobot.js";
import { transporterModel } from "./transporterRobot.js";
import { floorWasherModel } from "./floorWasherRobot.js";
import { weldArmModel } from "./weldArmRobot.js";
import { storageCubeModel } from "./storageCubeRobot.js";

// Все glb-модели роботов и техники, которые нужны сцене, — в одном месте, чтобы
// main.jsx и WarehouseScene не знали, сколько их и как они называются.
const MODELS = [vacuumModel, forkliftModel, truckModel, transporterModel, floorWasherModel, weldArmModel, storageCubeModel];

export const areRobotModelsReady = () => MODELS.every((model) => model.isReady());

export const loadRobotModels = () => Promise.all(MODELS.map((model) => model.load()));

// Прогрев: пока пользователь на экране настроек, модели уже грузятся.
export const preloadRobotModels = () => MODELS.forEach((model) => model.preload());
