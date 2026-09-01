import type { Controller } from 'lil-gui';
import { camera, gui, table } from './globals';
import {
  getActiveCameraViewLabel,
  getCameraCoordinateSpaceLabel,
  readCameraViewParams,
  setCameraViewByPlayerIndex,
  writeCameraViewParams,
} from './cameraView';

const NUMERIC_CAMERA_PARAMS = [
  'posX',
  'posY',
  'posZ',
  'rotX',
  'rotY',
  'rotZ',
] as const;
type NumericCameraParam = (typeof NUMERIC_CAMERA_PARAMS)[number];

const CAMERA_GUI_FOCUS_CLASS = 'camera-gui-focused';

const viewActions = {
  f1: () => previewPlayerView(0),
  f2: () => previewPlayerView(1),
  f3: () => previewPlayerView(2),
  f4: () => previewPlayerView(3),
};

let cameraDebugGuiReady = false;
let cameraGuiVisible = false;
let focusedSliderController: Controller | null = null;
let arrowKeyListenerRegistered = false;
let guiParams = {
  activeView: 'F1',
  coordinateSpace: 'World XYZ + rotation (degrees)',
  posX: 0,
  posY: 0,
  posZ: 0,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
};
let guiControllers: Controller[] = [];
let saveViewController: Controller | null = null;

function isNumericCameraParam(property: string): property is NumericCameraParam {
  return (NUMERIC_CAMERA_PARAMS as readonly string[]).includes(property);
}

function styleCameraGui() {
  if (!gui) return;
  const element = gui.domElement;
  element.style.position = 'fixed';
  element.style.top = '8px';
  element.style.right = '8px';
  element.style.zIndex = '1000';
  element.style.pointerEvents = 'auto';
}

function injectCameraGuiFocusStyles() {
  if (document.getElementById('camera-gui-focus-style')) return;

  const style = document.createElement('style');
  style.id = 'camera-gui-focus-style';
  style.textContent = `
    .lil-gui .controller.camera-gui-focused {
      outline: 1px solid rgba(100, 180, 255, 0.9);
      outline-offset: -1px;
      background: rgba(100, 180, 255, 0.12);
    }
  `;
  document.head.appendChild(style);
}

function updateFocusedControllerHighlight() {
  for (const controller of guiControllers) {
    controller.domElement.classList.toggle(
      CAMERA_GUI_FOCUS_CLASS,
      controller === focusedSliderController,
    );
  }
}

function updateGuiDisplays() {
  for (const controller of guiControllers) {
    controller.updateDisplay();
  }
}

export function syncCameraDebugGuiFromActiveView() {
  if (!cameraDebugGuiReady) return;

  const params = readCameraViewParams();
  guiParams.activeView = getActiveCameraViewLabel();
  guiParams.coordinateSpace = getCameraCoordinateSpaceLabel();
  guiParams.posX = params.posX;
  guiParams.posY = params.posY;
  guiParams.posZ = params.posZ;
  guiParams.rotX = params.rotX;
  guiParams.rotY = params.rotY;
  guiParams.rotZ = params.rotZ;
  saveViewController?.name(`Save ${getActiveCameraViewLabel()} view`);
  updateGuiDisplays();
}

function applyActiveCameraFromGui() {
  writeCameraViewParams(guiParams);
  guiParams.activeView = getActiveCameraViewLabel();
  guiParams.coordinateSpace = getCameraCoordinateSpaceLabel();
  updateGuiDisplays();
}

function getControllerStep(controller: Controller, shiftKey: boolean, property: string) {
  if (shiftKey) return property.startsWith('rot') ? 5 : 10;

  const step = (controller as Controller & { step?: number }).step;
  return typeof step === 'number' && step > 0 ? step : 1;
}

function getControllerBounds(controller: Controller, property: string) {
  const typed = controller as Controller & { min?: number; max?: number };
  if (property.startsWith('rot')) {
    return {
      min: typeof typed.min === 'number' ? typed.min : -180,
      max: typeof typed.max === 'number' ? typed.max : 180,
    };
  }

  return {
    min: typeof typed.min === 'number' ? typed.min : -500,
    max: typeof typed.max === 'number' ? typed.max : 500,
  };
}

function adjustFocusedSlider(deltaSteps: number) {
  if (!focusedSliderController || !isNumericCameraParam(focusedSliderController.property)) return;

  const property = focusedSliderController.property;
  const { min, max } = getControllerBounds(focusedSliderController, property);
  const nextValue = Math.min(max, Math.max(min, guiParams[property] + deltaSteps));

  if (nextValue === guiParams[property]) return;

  focusedSliderController.setValue(nextValue);
  applyActiveCameraFromGui();
}

function handleCameraGuiArrowKeys(event: KeyboardEvent) {
  if (!cameraGuiVisible || !focusedSliderController) return;
  if (event.repeat) return;

  const target = event.target as HTMLElement | null;
  if (
    target?.closest('input, textarea, [contenteditable="true"]') &&
    !target.closest('.lil-gui')
  ) {
    return;
  }

  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;

  event.preventDefault();

  const property = focusedSliderController.property;
  if (!isNumericCameraParam(property)) return;

  const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1;
  const step = getControllerStep(focusedSliderController, event.shiftKey, property);
  adjustFocusedSlider(direction * step);
}

function registerArrowKeyListener() {
  if (arrowKeyListenerRegistered) return;
  arrowKeyListenerRegistered = true;
  window.addEventListener('keydown', handleCameraGuiArrowKeys);
}

function bindSliderKeyboardControls(controller: Controller) {
  if (!isNumericCameraParam(controller.property)) return;

  controller.domElement.addEventListener('pointerdown', () => {
    focusedSliderController = controller;
    updateFocusedControllerHighlight();
  });
}

function previewPlayerView(index: number) {
  setCameraViewByPlayerIndex(index);
}

export function setupCameraDebugGui() {
  if (cameraDebugGuiReady || !gui || !camera || !table) return;
  cameraDebugGuiReady = true;

  injectCameraGuiFocusStyles();
  registerArrowKeyListener();

  const folder = gui.addFolder('Camera');
  folder.open();

  Object.assign(guiParams, readCameraViewParams());
  guiParams.activeView = getActiveCameraViewLabel();
  guiParams.coordinateSpace = getCameraCoordinateSpaceLabel();

  const positionFolder = folder.addFolder('Position (world)');
  const rotationFolder = folder.addFolder('Rotation (degrees)');

  guiControllers = [
    folder.add(guiParams, 'activeView').name('Editing view').disable(),
    folder.add(guiParams, 'coordinateSpace').name('Space').disable(),
    positionFolder.add(guiParams, 'posX', -500, 500, 1).name('X').onChange(applyActiveCameraFromGui),
    positionFolder.add(guiParams, 'posY', -500, 500, 1).name('Y').onChange(applyActiveCameraFromGui),
    positionFolder.add(guiParams, 'posZ', -500, 500, 1).name('Z').onChange(applyActiveCameraFromGui),
    rotationFolder
      .add(guiParams, 'rotX', -180, 180, 1)
      .name('pitch X')
      .onChange(applyActiveCameraFromGui),
    rotationFolder
      .add(guiParams, 'rotY', -180, 180, 1)
      .name('yaw Y')
      .onChange(applyActiveCameraFromGui),
    rotationFolder
      .add(guiParams, 'rotZ', -180, 180, 1)
      .name('roll Z')
      .onChange(applyActiveCameraFromGui),
  ];

  positionFolder.open();
  rotationFolder.open();

  saveViewController = folder
    .add({ save: applyActiveCameraFromGui }, 'save')
    .name('Save F1 view');

  guiControllers = [...guiControllers, saveViewController];

  for (const controller of guiControllers) {
    bindSliderKeyboardControls(controller);
  }

  focusedSliderController =
    guiControllers.find(
      controller => isNumericCameraParam(controller.property) && !controller._disabled,
    ) ?? null;
  updateFocusedControllerHighlight();

  const views = folder.addFolder('Player views');
  views.add(viewActions, 'f1').name('F1 preview');
  views.add(viewActions, 'f2').name('F2 preview');
  views.add(viewActions, 'f3').name('F3 preview');
  views.add(viewActions, 'f4').name('F4 preview');

  styleCameraGui();
  gui.show();
  cameraGuiVisible = true;
  syncCameraDebugGuiFromActiveView();
}

export function resetCameraDebugGui() {
  cameraDebugGuiReady = false;
  cameraGuiVisible = false;
  focusedSliderController = null;
  saveViewController = null;
  guiControllers = [];
}

export function toggleCameraDebugGui() {
  if (!gui) return;
  if (!cameraDebugGuiReady) {
    setupCameraDebugGui();
    return;
  }

  cameraGuiVisible = !cameraGuiVisible;
  if (cameraGuiVisible) {
    styleCameraGui();
    gui.show();
    syncCameraDebugGuiFromActiveView();
  } else {
    gui.hide();
    focusedSliderController = null;
    updateFocusedControllerHighlight();
  }
}

export function isCameraDebugGuiVisible() {
  return cameraGuiVisible;
}
