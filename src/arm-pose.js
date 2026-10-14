import * as THREE from 'three';

// Only additive local bone rotations: never translate/scale the mesh or joints.
// These are editing guards, not anatomical IK limits.
export const POSE_LIMITS = { clavicle: 25, upper: 45, forearm: 40, hand: 35 };
export const POSE_LABELS = { clavicle: 'Ключица', upper: 'Плечо', forearm: 'Предплечье', hand: 'Кисть' };

export function identifyArmBone(bone) {
  if (!bone?.isBone || !bone.name) return null;
  const name = bone.name.toLowerCase().replace(/^mixamorig\d*[:_]?/, '').trim();
  if (/finger|thumb|index|middle|ring|pinky|toe|leg|thigh|foot|twist|roll|_ik|\.ik|pole|end\d*$/.test(name)) return null;
  const side = /left/.test(name) ? 'left' : /right/.test(name) ? 'right'
    : /(^|[^a-z])l($|[^a-z])/.test(name) || /^l(?:arm|hand|forearm|shoulder|clavicle)/.test(name) ? 'left'
    : /(^|[^a-z])r($|[^a-z])/.test(name) || /^r(?:arm|hand|forearm|shoulder|clavicle)/.test(name) ? 'right' : null;
  if (!side) return null;
  const joint = /clavicle|collar|shoulder/.test(name) ? 'clavicle'
    : /forearm|lowerarm|elbow/.test(name) ? 'forearm'
    : /hand|wrist/.test(name) ? 'hand'
    : /upperarm|arm/.test(name) ? 'upper' : null;
  if (!joint) return null;
  const score = (name.includes(side) ? 3 : 1) + (!/helper|socket|target/.test(name) ? 2 : 0)
    + (joint === 'upper' && /upperarm/.test(name) ? 2 : 0);
  return { side, joint, score };
}

export function resolveArmBones(bones) {
  const resolved = { left: {}, right: {} };
  const scores = { left: {}, right: {} };
  for (const bone of bones) {
    const match = identifyArmBone(bone);
    if (!match) continue;
    if ((scores[match.side][match.joint] ?? -1) < match.score) {
      resolved[match.side][match.joint] = bone;
      scores[match.side][match.joint] = match.score;
    }
  }
  return resolved;
}

export function deltaQuaternion(angles) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(angles.x || 0),
    THREE.MathUtils.degToRad(angles.y || 0),
    THREE.MathUtils.degToRad(angles.z || 0),
    'XYZ'
  ));
}

export class ArmPoseController {
  constructor() {
    this.offsets = new Map(); // bone -> {x,y,z}
    this.applied = new Map(); // bone -> base quaternion before the last overlay
  }
  restore() {
    for (const [bone, before] of this.applied) bone.quaternion.copy(before);
    this.applied.clear();
  }
  apply() {
    this.restore();
    for (const [bone, angles] of this.offsets) {
      if (!bone?.isBone) continue;
      this.applied.set(bone, bone.quaternion.clone());
      bone.quaternion.multiply(deltaQuaternion(angles)).normalize();
    }
  }
  get(bone) {
    const found = this.offsets.get(bone);
    return found ? { ...found } : {x:0, y:0, z:0};
  }
  set(bone, angles) {
    if (!bone?.isBone) return;
    const sanitized = {};
    for (const axis of ['x','y','z']) {
      const n = Number(angles[axis]);
      sanitized[axis] = Number.isFinite(n) ? n : 0;
    }
    if (Object.values(sanitized).every(v => Math.abs(v) < .00001)) this.offsets.delete(bone);
    else this.offsets.set(bone, sanitized);
    this.apply();
  }
  clearBones(bones) {
    this.restore();
    for (const bone of bones) this.offsets.delete(bone);
    this.apply();
  }
  clearAll() {
    this.restore();
    this.offsets.clear();
  }
}

// Bake the same offset used by live preview into quaternion keyframes.
// Imported GLB will therefore play corrected animations outside the editor,
// rather than depending on our runtime overlay.
export function bakePoseClips(clips, offsets) {
  const byName = new Map();
  for (const [bone, angles] of offsets) {
    const q = deltaQuaternion(angles);
    byName.set(bone.name, q);
    byName.set(bone.uuid, q);
  }
  if (!byName.size) return { clips, modified: 0, skipped: 0 };
  let modified = 0;
  let skipped = 0;
  const output = clips.map(clip => {
    const copy = clip.clone();
    copy.tracks = copy.tracks.map(track => {
      let parsed;
      try { parsed = THREE.PropertyBinding.parseTrackName(track.name); }
      catch { return track; }
      const qOffset = byName.get(parsed.nodeName);
      if (!qOffset) return track;
      if (parsed.propertyName !== 'quaternion' || track.getValueSize() !== 4) {
        skipped++;
        return track;
      }
      for (let i=0; i<track.values.length; i+=4) {
        const q = new THREE.Quaternion().fromArray(track.values, i);
        q.multiply(qOffset).normalize().toArray(track.values,i);
      }
      modified++;
      return track;
    });
    return copy;
  });
  return { clips: output, modified, skipped };
}
