// shared/pose-engine.js — DETECTION engine loader (DETECTION-MIGRATE, skill movement-tracking §1)
// Loads MediaPipe Pose Landmarker (delegate GPU → CPU) and falls back to MoveNet if
// MediaPipe cannot load at all. Every frame is normalized through toNova() — game code
// never sees raw engine keypoints. Logs `[POSE] engine=<name> fps=<n>` every 5s.
import { toNova } from './pose-adapter.js';

const TASKS_VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
// The model is self-hosted (DETECTION-MIGRATE §3): served next to the pages, never the CDN.
const MODEL_URL = new URL('../models/pose_landmarker_lite.task', import.meta.url).href;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('script ' + src));
    document.head.appendChild(s);
  });
}

export const PoseEngine = {
  engine: null,          // 'mediapipe' | 'movenet' after start()
  _mp: null, _movenet: null, _running: false,
  _frames: 0, _lastLog: 0, fps: 0,

  async _initMediapipe() {
    const vision = await import(TASKS_VISION);
    const files = await vision.FilesetResolver.forVisionTasks(TASKS_VISION + '/wasm');
    const opts = delegate => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO', numPoses: 1,
      outputSegmentationMasks: false,     // off for now (DETECTION-MIGRATE §3)
    });
    try {
      this._mp = await vision.PoseLandmarker.createFromOptions(files, opts('GPU'));
    } catch (e) {
      console.log('[POSE] GPU delegate failed (' + (e && e.message || e) + ') -> CPU');
      this._mp = await vision.PoseLandmarker.createFromOptions(files, opts('CPU'));
    }
    return 'mediapipe';
  },

  async _initMovenet() {
    if (!window.tf) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');
    if (!window.poseDetection) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js');
    await tf.setBackend('webgl');
    this._movenet = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING });
    return 'movenet';
  },

  /* start(videoEl, onPose): resolves with the engine name once a detector is live.
     onPose(nova, engine) fires per frame with toNova() output (may hold zero joints
     when nobody is confidently visible — the caller decides what absence means). */
  async start(videoEl, onPose) {
    try { this.engine = await this._initMediapipe(); }
    catch (e) {
      console.log('[POSE] mediapipe unavailable (' + (e && e.message || e) + ') -> movenet fallback');
      this.engine = await this._initMovenet();   // throws to the caller if this fails too
    }
    this._running = true; this._lastLog = performance.now();
    let lastVideoT = -1;
    const tick = async () => {
      if (!this._running) return;
      try {
        if (videoEl.readyState >= 2 && videoEl.currentTime !== lastVideoT) {
          lastVideoT = videoEl.currentTime;
          let result;
          if (this.engine === 'mediapipe') {
            result = this._mp.detectForVideo(videoEl, performance.now());
          } else {
            const poses = await this._movenet.estimatePoses(videoEl, { flipHorizontal: false });
            result = { keypoints: poses[0] ? poses[0].keypoints : null };
          }
          this._frames++;
          onPose(toNova(result, this.engine), this.engine);
        }
      } catch (_) { /* single bad frame: skip, keep the loop alive */ }
      const now = performance.now();
      if (now - this._lastLog >= 5000) {
        this.fps = Math.round(this._frames / ((now - this._lastLog) / 1000));
        console.log('[POSE] engine=' + this.engine + ' fps=' + this.fps);
        this._frames = 0; this._lastLog = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return this.engine;
  },

  stop() { this._running = false; },
};

// startPose(video, cb) — the per-game entry the pages use: start the engine and hand each
// frame's toNova() named-joints object to cb. (Wrapper over PoseEngine.start; b0.13.)
export function startPose(video, cb) {
  return PoseEngine.start(video, (nova /*, engine */) => cb(nova));
}
