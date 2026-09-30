import type { Rectangle } from "electron";

const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 410;
const WINDOW_INSET = 10;
const GAP = 8;
const CAPSULE_VISIBLE_HEIGHT = 44;

/** Place the visible panel next to the visible capsule, in DIP coordinates. */
export function panelBounds(
  capsule: Rectangle,
  capsuleVisibleWidth: number,
  workArea: Rectangle,
): Rectangle {
  const width = Math.min(PANEL_WIDTH, Math.max(1, workArea.width - 24));
  const preferredHeight = Math.min(
    PANEL_HEIGHT,
    Math.max(1, workArea.height - 24),
  );
  const visibleLeft = capsule.x + WINDOW_INSET;
  const visibleRight = visibleLeft + capsuleVisibleWidth;
  const rightAlignedX = visibleRight - width + WINDOW_INSET;
  const leftAlignedX = visibleLeft - WINDOW_INSET;
  const fits = (x: number) =>
    x >= workArea.x && x + width <= workArea.x + workArea.width;
  const x = fits(rightAlignedX)
    ? rightAlignedX
    : fits(leftAlignedX)
      ? leftAlignedX
      : Math.max(
          workArea.x,
          Math.min(rightAlignedX, workArea.x + workArea.width - width),
        );

  const visibleTop = capsule.y + WINDOW_INSET;
  const visibleBottom = visibleTop + CAPSULE_VISIBLE_HEIGHT;
  const belowY = visibleBottom + GAP - WINDOW_INSET;
  const aboveBottom = visibleTop - GAP + WINDOW_INSET;
  const belowSpace = workArea.y + workArea.height - belowY;
  const aboveSpace = aboveBottom - workArea.y;
  const below =
    belowSpace >= preferredHeight ||
    (aboveSpace < preferredHeight && belowSpace >= aboveSpace);
  const height = Math.max(
    1,
    Math.min(preferredHeight, below ? belowSpace : aboveSpace),
  );
  const y = below ? belowY : aboveBottom - height;
  return {
    x: Math.round(x),
    y: Math.round(
      Math.max(
        workArea.y,
        Math.min(y, workArea.y + workArea.height - height),
      ),
    ),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Prefer the display that can keep the panel closest to its capsule anchor. */
export function nearestPanelBounds(
  capsule: Rectangle,
  capsuleVisibleWidth: number,
  workAreas: readonly Rectangle[],
): Rectangle {
  const firstArea = workAreas[0];
  if (!firstArea) throw new Error("面板没有可用屏幕。");
  const capsuleLeft = capsule.x + WINDOW_INSET;
  const capsuleRight = capsuleLeft + capsuleVisibleWidth;
  const capsuleTop = capsule.y + WINDOW_INSET;
  const capsuleBottom = capsuleTop + CAPSULE_VISIBLE_HEIGHT;
  const score = (panel: Rectangle) => {
    const left = panel.x + WINDOW_INSET;
    const right = panel.x + panel.width - WINDOW_INSET;
    const top = panel.y + WINDOW_INSET;
    const bottom = panel.y + panel.height - WINDOW_INSET;
    const alignment = Math.min(
      Math.abs(left - capsuleLeft),
      Math.abs(right - capsuleRight),
    );
    const gap = Math.min(
      Math.abs(top - capsuleBottom - GAP),
      Math.abs(capsuleTop - bottom - GAP),
    );
    return alignment + gap * 2 + (PANEL_HEIGHT - panel.height) / 10;
  };
  let best = panelBounds(capsule, capsuleVisibleWidth, firstArea);
  let bestScore = score(best);
  for (const area of workAreas.slice(1)) {
    const candidate = panelBounds(capsule, capsuleVisibleWidth, area);
    const candidateScore = score(candidate);
    if (candidateScore < bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  return best;
}
