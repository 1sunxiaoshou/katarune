import type { LiveSettings } from "../../shared/live";

// This is the local media source. The streaming application encodes its own final output.
export function liveOutputProfile(settings: Pick<LiveSettings, "width">) {
  return { fps: 60, videoBitrateKbps: settings.width === 2560 ? 24000 : settings.width === 1920 ? 12000 : 6000 };
}
