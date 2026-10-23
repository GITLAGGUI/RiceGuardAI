import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bounds, ContactShadows, Environment, useGLTF } from "@react-three/drei";
import type { Group } from "three";

function Drone() {
  const group = useRef<Group>(null);
  const { scene } = useGLTF("/models/cesium-drone.glb");
  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.rotation.y = -0.55 + Math.sin(clock.elapsedTime * 0.32) * 0.12;
    group.current.rotation.z = Math.sin(clock.elapsedTime * 0.45) * 0.025;
    group.current.position.y = Math.sin(clock.elapsedTime * 0.72) * 0.05;
  });
  return (
    <group ref={group} rotation={[0.08, -0.55, -0.05]}>
      <primitive object={scene} />
    </group>
  );
}

export default function HeroScene() {
  return (
    <Canvas
      camera={{ position: [3.4, 2.2, 5.2], fov: 34 }}
      dpr={[1, 1.45]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      aria-label="Decorative 3D drone illustration"
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[4, 7, 5]} intensity={3.2} />
      <Suspense fallback={null}>
        <Bounds fit clip observe margin={1.25}>
          <Drone />
        </Bounds>
        <Environment preset="sunset" />
        <ContactShadows position={[0, -1.15, 0]} opacity={0.28} scale={5} blur={2.4} />
      </Suspense>
    </Canvas>
  );
}

useGLTF.preload("/models/cesium-drone.glb");
