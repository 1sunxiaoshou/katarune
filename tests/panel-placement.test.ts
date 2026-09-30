import { describe, expect, it } from "vitest";
import {
  nearestPanelBounds,
  panelBounds,
} from "../src/main/avatar/panelPlacement";

describe("desktop panel placement", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };

  it("opens immediately below the capsule and aligns visible right edges", () => {
    const panel = panelBounds(
      { x: 100, y: 80, width: 240, height: 64 },
      220,
      workArea,
    );
    expect(panel).toEqual({ x: 20, y: 132, width: 320, height: 410 });
  });

  it("opens above a capsule near the bottom edge", () => {
    const panel = panelBounds(
      { x: 1600, y: 950, width: 240, height: 64 },
      220,
      workArea,
    );
    expect(panel).toEqual({ x: 1520, y: 552, width: 320, height: 410 });
  });

  it("aligns visible left edges when right alignment would leave the screen", () => {
    const panel = panelBounds(
      { x: 0, y: 80, width: 240, height: 64 },
      220,
      workArea,
    );
    expect(panel.x).toBe(0);
    expect(panel.y).toBe(132);
  });

  it("shrinks on a short screen while remaining adjacent to the capsule", () => {
    const panel = panelBounds(
      { x: 500, y: 260, width: 240, height: 64 },
      220,
      { x: 0, y: 0, width: 1024, height: 600 },
    );
    expect(panel).toEqual({ x: 420, y: 312, width: 320, height: 288 });
  });

  it("uses the compact capsule's visible width", () => {
    const panel = panelBounds(
      { x: 500, y: 80, width: 240, height: 64 },
      100,
      workArea,
    );
    expect(panel.x).toBe(300);
  });

  it("keeps the panel next to a capsule on a negative-origin display", () => {
    const panel = panelBounds(
      { x: -1250, y: 20, width: 240, height: 64 },
      220,
      { x: -1280, y: 0, width: 1280, height: 1024 },
    );
    expect(panel).toEqual({ x: -1250, y: 72, width: 320, height: 410 });
  });

  it("uses the adjacent display when clamping to the capsule center's display would leave a large gap", () => {
    const panel = nearestPanelBounds(
      { x: 1870, y: 100, width: 240, height: 64 },
      220,
      [
        { x: 1920, y: 400, width: 1920, height: 1080 },
        { x: 0, y: 0, width: 1920, height: 1080 },
      ],
    );
    expect(panel).toEqual({ x: 1600, y: 152, width: 320, height: 410 });
  });
});
