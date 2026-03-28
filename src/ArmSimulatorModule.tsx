import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SidebarModuleProps } from './modules/moduleTypes';

interface JointValues {
  baseYaw: number;
  shoulderPitch: number;
  elbowPitch: number;
  wristPitch: number;
}

interface ArmRig {
  root: THREE.Group;
  shoulderPivot: THREE.Group;
  elbowPivot: THREE.Group;
  wristPivot: THREE.Group;
  segments: {
    upperArm: THREE.Mesh;
    forearm: THREE.Mesh;
    wrist: THREE.Mesh;
    endEffector: THREE.Mesh;
  };
}

const SEGMENT_LENGTHS = {
  baseHeight: 1.1,
  upperArm: 2.0,
  forearm: 1.6,
  wrist: 0.9,
};

const INITIAL_JOINTS: JointValues = {
  baseYaw: 12,
  shoulderPitch: 28,
  elbowPitch: -36,
  wristPitch: 20,
};

export default function ArmSimulatorModule({ runtime }: SidebarModuleProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rigRef = useRef<ArmRig | null>(null);
  const tipRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const jointsRef = useRef<JointValues>(INITIAL_JOINTS);
  const [joints, setJoints] = useState<JointValues>(INITIAL_JOINTS);

  const recommendedPose = useMemo(() => {
    const axisCount = Math.max(3, runtime.telemetry.axes.length);
    const avgAxis =
      runtime.telemetry.axes.length > 0
        ? runtime.telemetry.axes.reduce((sum, axis) => sum + axis.position, 0) / runtime.telemetry.axes.length
        : 0;

    return {
      baseYaw: Math.max(-90, Math.min(90, avgAxis * 0.35)),
      shoulderPitch: 14 + axisCount * 3,
      elbowPitch: -25 - runtime.telemetry.activeWcs * 2,
      wristPitch: 8 + runtime.telemetry.activeWcs,
    };
  }, [runtime.telemetry.activeWcs, runtime.telemetry.axes]);

  useEffect(() => {
    jointsRef.current = joints;
  }, [joints]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0d1726');

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(6, 5, 7);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(0, 1.8, 0);

    const hemi = new THREE.HemisphereLight('#9fb0cf', '#0a0f1a', 0.85);
    const key = new THREE.DirectionalLight('#ffffff', 1.2);
    key.position.set(5, 10, 6);
    const fill = new THREE.DirectionalLight('#7dd3fc', 0.55);
    fill.position.set(-4, 5, -3);
    scene.add(hemi, key, fill);

    const grid = new THREE.GridHelper(16, 16, '#3b82f6', '#23314a');
    scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(8, 32),
      new THREE.MeshStandardMaterial({ color: '#101a2c', transparent: true, opacity: 0.75, side: THREE.DoubleSide })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const axes = new THREE.AxesHelper(2.2);
    axes.position.y = 0.02;
    scene.add(axes);

    rigRef.current = createArmRig();
    scene.add(rigRef.current.root);

    const targetDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 16, 16),
      new THREE.MeshStandardMaterial({ color: '#22d3ee', emissive: '#0e7490', emissiveIntensity: 0.5 })
    );
    scene.add(targetDot);

    const reticle = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.012, 8, 48),
      new THREE.MeshStandardMaterial({ color: '#22d3ee', transparent: true, opacity: 0.85 })
    );
    reticle.rotation.x = Math.PI / 2;
    scene.add(reticle);

    host.appendChild(renderer.domElement);

    const resize = () => {
      const width = Math.max(280, host.clientWidth);
      const height = Math.max(280, Math.round(width * 0.75));
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();

    const loop = () => {
      if (!rigRef.current) return;
      applyJointAngles(rigRef.current, jointsRef.current);
      const tip = getEndEffectorPosition(rigRef.current, tipRef.current);
      targetDot.position.copy(tip);
      reticle.position.set(tip.x, 0.01, tip.z);
      controls.update();
      renderer.render(scene, camera);
      raf = window.requestAnimationFrame(loop);
    };

    let raf = window.requestAnimationFrame(loop);
    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      disposeScene(scene);
      rigRef.current = null;
    };
  }, []);

  return (
    <div style={s.wrap}>
      <div style={s.tip}>
        Internal Three.js arm-sim example (React {`+`} Vite). Ready as a future integration baseline.
      </div>
      <div ref={hostRef} style={s.canvasHost} />
      <div style={s.grid}>
        <JointControl
          label="Base Yaw"
          min={-160}
          max={160}
          value={joints.baseYaw}
          onChange={(value) => setJoints((prev) => ({ ...prev, baseYaw: value }))}
        />
        <JointControl
          label="Shoulder"
          min={-60}
          max={110}
          value={joints.shoulderPitch}
          onChange={(value) => setJoints((prev) => ({ ...prev, shoulderPitch: value }))}
        />
        <JointControl
          label="Elbow"
          min={-135}
          max={80}
          value={joints.elbowPitch}
          onChange={(value) => setJoints((prev) => ({ ...prev, elbowPitch: value }))}
        />
        <JointControl
          label="Wrist"
          min={-95}
          max={95}
          value={joints.wristPitch}
          onChange={(value) => setJoints((prev) => ({ ...prev, wristPitch: value }))}
        />
      </div>
      <button
        style={s.recommendBtn}
        onClick={() => setJoints(recommendedPose)}
        title="Set a quick machine-aware pose from current VMill telemetry"
      >
        Apply machine-aware pose
      </button>
    </div>
  );
}

function JointControl({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={s.control}>
      <span style={s.controlLabel}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <strong style={s.controlValue}>{value.toFixed(0)}°</strong>
    </label>
  );
}

function createArmRig(): ArmRig {
  const root = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.9, SEGMENT_LENGTHS.baseHeight, 36),
    new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.45, metalness: 0.5 })
  );
  base.position.y = SEGMENT_LENGTHS.baseHeight / 2;
  root.add(base);

  const shoulderPivot = new THREE.Group();
  shoulderPivot.position.y = SEGMENT_LENGTHS.baseHeight;
  root.add(shoulderPivot);

  const upperArm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, SEGMENT_LENGTHS.upperArm, 8, 18),
    new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.35, metalness: 0.35 })
  );
  upperArm.rotation.z = Math.PI / 2;
  upperArm.position.x = SEGMENT_LENGTHS.upperArm * 0.5;
  shoulderPivot.add(upperArm);

  const elbowPivot = new THREE.Group();
  elbowPivot.position.x = SEGMENT_LENGTHS.upperArm;
  shoulderPivot.add(elbowPivot);

  const forearm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.22, SEGMENT_LENGTHS.forearm, 8, 16),
    new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.3, metalness: 0.4 })
  );
  forearm.rotation.z = Math.PI / 2;
  forearm.position.x = SEGMENT_LENGTHS.forearm * 0.5;
  elbowPivot.add(forearm);

  const wristPivot = new THREE.Group();
  wristPivot.position.x = SEGMENT_LENGTHS.forearm;
  elbowPivot.add(wristPivot);

  const wrist = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, SEGMENT_LENGTHS.wrist, 20),
    new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.28, metalness: 0.4 })
  );
  wrist.rotation.z = Math.PI / 2;
  wrist.position.x = SEGMENT_LENGTHS.wrist * 0.5;
  wristPivot.add(wrist);

  const endEffector = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.36, 0.46),
    new THREE.MeshStandardMaterial({ color: '#0ea5e9', roughness: 0.2, metalness: 0.35 })
  );
  endEffector.position.x = SEGMENT_LENGTHS.wrist;
  wristPivot.add(endEffector);

  return {
    root,
    shoulderPivot,
    elbowPivot,
    wristPivot,
    segments: { upperArm, forearm, wrist, endEffector },
  };
}

function applyJointAngles(rig: ArmRig, joints: JointValues) {
  rig.root.rotation.y = THREE.MathUtils.degToRad(joints.baseYaw);
  rig.shoulderPivot.rotation.z = THREE.MathUtils.degToRad(joints.shoulderPitch);
  rig.elbowPivot.rotation.z = THREE.MathUtils.degToRad(joints.elbowPitch);
  rig.wristPivot.rotation.z = THREE.MathUtils.degToRad(joints.wristPitch);
}

function getEndEffectorPosition(rig: ArmRig, target: THREE.Vector3) {
  rig.segments.endEffector.getWorldPosition(target);
  return target;
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    materials.forEach((material) => material.dispose());
  });
}

const s: Record<string, CSSProperties> = {
  wrap: {
    display: 'grid',
    gap: 8,
  },
  tip: {
    fontSize: 10,
    color: '#9fb0cf',
    lineHeight: 1.3,
  },
  canvasHost: {
    width: '100%',
    minHeight: 280,
    border: '1px solid #22304f',
    borderRadius: 6,
    overflow: 'hidden',
    background: '#0d1726',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
  },
  control: {
    display: 'grid',
    gap: 4,
    border: '1px solid #22304f',
    borderRadius: 6,
    padding: 6,
    background: '#0f1b2f',
  },
  controlLabel: {
    fontSize: 10,
    color: '#9fb0cf',
    fontWeight: 700,
  },
  controlValue: {
    fontSize: 11,
    color: '#dbeafe',
  },
  recommendBtn: {
    border: '1px solid #2a395a',
    background: '#13203a',
    color: '#9fb0cf',
    borderRadius: 4,
    fontSize: 11,
    cursor: 'pointer',
    padding: '6px 8px',
    fontWeight: 700,
  },
};
