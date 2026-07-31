import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const builderConfig = readFileSync(
  resolve(projectRoot, "electron-builder.yml"),
  "utf8",
);
const electronViteConfig = readFileSync(
  resolve(projectRoot, "electron.vite.config.ts"),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, "package.json"), "utf8"),
) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const nsisIncludeBytes = readFileSync(
  resolve(projectRoot, "resources", "installer.nsh"),
);
const nsisInclude = readFileSync(
  resolve(projectRoot, "resources", "installer.nsh"),
  "utf8",
);

describe("desktop packaging configuration", () => {
  it("locks the production identity, platform targets, and compression policy", () => {
    expect(builderConfig).toContain("appId: app.katarune.desktop");
    expect(builderConfig).toContain("compression: normal");
    expect(builderConfig).toMatch(/win:\s+target:\s+- target: nsis/s);
    expect(builderConfig).toMatch(
      /mac:\s+target:\s+- target: dmg[\s\S]+- target: zip/s,
    );
    expect(builderConfig).toMatch(
      /linux:\s+target:\s+- target: AppImage[\s\S]+- target: deb/s,
    );
    expect(builderConfig).not.toMatch(/target:\s+(portable|nsis-web|squirrel)/);
  });

  it("keeps the Windows installer per-user, one-click, and differential-aware", () => {
    expect(builderConfig).toMatch(/nsis:[\s\S]+oneClick: true/s);
    expect(builderConfig).toContain(
      'artifactName: "${productName}-Setup-${version}.${ext}"',
    );
    expect(builderConfig).toContain("perMachine: false");
    expect(builderConfig).toContain("createDesktopShortcut: false");
    expect(builderConfig).toContain("createStartMenuShortcut: true");
    expect(builderConfig).toContain("deleteAppDataOnUninstall: false");
    expect(builderConfig).toContain("differentialPackage: true");
    expect(builderConfig).toContain("useZip: false");
    expect(builderConfig).toContain("verifyUpdateCodeSignature: true");
  });

  it("unpacks only the better-sqlite3 runtime binary and excludes source maps", () => {
    expect(builderConfig).toMatch(/asar:\s+smartUnpack: false/s);
    expect(builderConfig).toContain(
      "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    );
    expect(builderConfig).not.toContain("node_modules/better-sqlite3/**/*");
    expect(builderConfig).toContain('"!**/*.map"');
    expect(builderConfig).toContain(
      '"!node_modules/**/{test,tests,__tests__}/**/*"',
    );
    expect(builderConfig).toContain(
      '"!node_modules/better-sqlite3/deps/**/*"',
    );
    expect(builderConfig).toContain(
      '"!node_modules/better-sqlite3/build/Release/obj/**/*"',
    );
  });

  it("bundles main-process assistant-ui adapters without shipping renderer dependencies twice", () => {
    expect(electronViteConfig).toMatch(
      /externalizeDeps:\s*\{[\s\S]+exclude:\s*\[[\s\S]+["']@assistant-ui\/react["'][\s\S]+["']@assistant-ui\/react-ai-sdk["']/,
    );
    expect(packageJson.dependencies).toHaveProperty("@ai-sdk/mcp");
    expect(packageJson.dependencies).toHaveProperty("assistant-stream");

    for (const rendererDependency of [
      "@assistant-ui/react",
      "@assistant-ui/react-ai-sdk",
      "@assistant-ui/react-markdown",
      "@base-ui/react",
      "lucide-react",
      "react",
      "react-dom",
      "react-easy-crop",
      "remark-gfm",
      "zustand",
    ]) {
      expect(packageJson.dependencies).not.toHaveProperty(rendererDependency);
      expect(packageJson.devDependencies).toHaveProperty(rendererDependency);
    }
  });
});

describe("NSIS uninstall cleanup policy", () => {
  it("offers localized preserve-or-delete cleanup without replacing the stock script", () => {
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
