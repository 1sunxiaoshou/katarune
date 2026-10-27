import type { Buffer } from "node:buffer";
export interface CameraFixtureDocument {
  cameras: { type: string; perspective?: { yfov: number; znear: number; zfar: number }; orthographic?: { xmag: number; ymag: number; znear: number; zfar: number } }[];
  buffers: { byteLength: number; uri?: string }[];
}
export function cameraGlb(options?: {
  times?: number[]; positions?: number[][]; fovs?: number[]; rotations?: number[][];
  interpolation?: "LINEAR" | "STEP" | "CUBICSPLINE";
  mutate?: (document: CameraFixtureDocument) => void;
}): Buffer;
export function packGlb(document: unknown, binary?: Buffer): Buffer;
