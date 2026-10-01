import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const builderConfig = readFileSync(
  resolve(projectRoot, "electron-builder.yml"),
  "utf8",
);
const nsisIncludeBytes = readFileSync(
  resolve(projectRoot, "resources", "installer.nsh"),
);
const nsisInclude = readFileSync(
  resolve(projectRoot, "resources", "installer.nsh"),
  "utf8",
);

describe("NSIS uninstall cleanup policy", () => {
  it("offers localized preserve-or-delete cleanup without replacing the stock script", () => {
    expect(builderConfig).toContain("deleteAppDataOnUninstall: false");
    expect([...nsisIncludeBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(builderConfig).toContain("include: installer.nsh");
    expect(nsisInclude).toContain(
      "Section /o \"un.$(KataruneDeleteAllLocalData)\"",
    );
    expect(nsisInclude).toContain("LangString KataruneCleanupPageText 1033");
    expect(nsisInclude).toContain("LangString KataruneCleanupPageText 2052");
    expect(nsisInclude).toContain("SetSilent normal");
  });

  it("skips prompts and cleanup during an automatic update", () => {
    expect(nsisInclude).toMatch(
      /!macro customUnInit[\s\S]+?\$\{IfNot\} \$\{isUpdated\}/,
    );
    expect(nsisInclude).toMatch(
      /!macro customUnInstall[\s\S]+?\$\{IfNot\} \$\{isUpdated\}/,
    );
    expect(nsisInclude).toMatch(
      /!macro customUnInstallSection[\s\S]+?\$\{IfNot\} \$\{isUpdated\}/,
    );
    expect(nsisInclude).toContain('${GetOptions} $R0 "/S" $R1');
  });

  it("uses fixed application-owned cleanup roots", () => {
    expect(nsisInclude).toContain(
      '"$APPDATA\\${APP_FILENAME}\\tts-cache"',
    );
    expect(nsisInclude).toContain(
      '"$APPDATA\\${APP_FILENAME}\\asset-staging"',
    );
    expect(nsisInclude).toContain(
      '"$LOCALAPPDATA\\${APP_PACKAGE_NAME}-updater"',
    );
    expect(nsisInclude).toContain('"$APPDATA\\${APP_FILENAME}"');
  });
});
