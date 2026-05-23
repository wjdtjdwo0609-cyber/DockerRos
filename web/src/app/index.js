// app/ holds composition-root helpers that don't belong to any single
// domain — wiring, browser glue, error reporting. Imported by app.js via
// web/src/public-api/index.js.
export { installBrowserErrorReporter } from './installBrowserErrorReporter.js';
export { createCameraControls, VIEW_PRESETS } from './cameraControls.js';
export { installKeyboardPan } from './keyboardPan.js';
export { createRosJointMirror } from './rosJointMirror.js';
