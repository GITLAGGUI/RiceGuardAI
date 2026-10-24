/** Pointer (-1..1), hero scroll progress (0..1) and the last pointer move time, shared between the DOM hero and the 3D scene without re-rendering React. */
export const heroInput = { x: 0, y: 0, scroll: 0, moved: -1e9 };

export type Pose = "search-right" | "search-left" | "search-hover" | "stop" | "think" | "clipboard" | "notes" | "examine" | "confirmed";
export type Finding = "blb" | "healthy" | "brownspot";

/** What the 3D scene drives on the DOM mascot every frame (screen pixels inside the hero). */
export interface MascotRig {
  /** Lens position, body size in px, tilt in degrees, extra squash/stretch, overall opacity. */
  place(lensX: number, lensY: number, size: number, tilt: number, squash: number, opacity: number): void;
  /** Light cone from the lens to an ellipse on the ground. */
  beam(lensX: number, lensY: number, poolX: number, poolY: number, rx: number, ry: number, strength: number): void;
  /** Place the finding card beside the mascot and point its connector at the inspected spot. */
  card(lensX: number, lensY: number, body: number, pointX: number, pointY: number): void;
  pose(next: Pose): void;
  step(finding: Finding, step: number): void;
}

export const heroRig: { current: MascotRig | null } = { current: null };
