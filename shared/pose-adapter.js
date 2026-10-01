// shared/pose-adapter.js — normalize any engine to Nova's named joints
// Source: .claude/skills/movement-tracking SKILL.md §2 (v2, Sept 2026) — verbatim, the law.
// All detectors read toNova() names — never raw indices.
export const MP = { nose:0, lShoulder:11, rShoulder:12, lElbow:13, rElbow:14, lWrist:15, rWrist:16,
  lPinky:17, rPinky:18, lIndex:19, rIndex:20, lThumb:21, rThumb:22, lHip:23, rHip:24, lKnee:25, rKnee:26,
  lAnkle:27, rAnkle:28, lHeel:29, rHeel:30, lFoot:31, rFoot:32 };
export const MOVENET = { nose:0, lShoulder:5, rShoulder:6, lElbow:7, rElbow:8, lWrist:9, rWrist:10, lHip:11, rHip:12, lKnee:13, rKnee:14, lAnkle:15, rAnkle:16 };
export function toNova(result, engine){                       // → { name:{x,y,z,vis} } normalized, plus world[] if available
  const map = engine==='mediapipe' ? MP : MOVENET, src = engine==='mediapipe' ? result.landmarks[0] : result.keypoints;
  const out = {};
  for (const [name, i] of Object.entries(map)){ const p = src?.[i]; if(!p) continue;
    out[name] = engine==='mediapipe' ? { x:p.x, y:p.y, z:p.z, vis:p.visibility } : { x:p.x, y:p.y, z:0, vis:p.score }; }
  out.world = engine==='mediapipe' ? result.worldLandmarks?.[0] : null;   // meters, hips-origin
  out.mask  = engine==='mediapipe' ? result.segmentationMasks?.[0] : null;
  return out;
}
