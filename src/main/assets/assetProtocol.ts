import { existsSync, readFileSync } from "node:fs";
import { protocol } from "electron";
import type { DatabaseRuntime } from "../database/database";
import type { AssetService } from "./assetService";

export const ASSET_SCHEME = "katarune-asset";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

function response(status: number, body: BodyInit | null = null, headers?: HeadersInit): Response {
  return new Response(body, headers === undefined ? { status } : { status, headers });
}

export function handleAssetRequest(
  request: Request,
  database: DatabaseRuntime,
  assetService: AssetService,
): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return response(405, null, { Allow: "GET, HEAD" });
  }

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return response(400);
  }
  const assetId = url.pathname.slice(1);
  if (
    (url.hostname !== "asset" && url.hostname !== "staged") ||
    url.search !== "" ||
    url.hash !== "" ||
    !UUID_PATTERN.test(assetId)
  ) {
    return response(400);
  }

  if (url.hostname === "staged") {
    let staged;
    try {
      staged = assetService.resolveStagedPortrait(assetId);
    } catch {
      return response(404);
    }
    const headers = {
      "Cache-Control": "no-store",
      "Content-Length": String(staged.byteSize),
      "Content-Type": staged.mimeType,
      "X-Content-Type-Options": "nosniff",
    };
    return response(
      200,
      request.method === "HEAD" ? null : readFileSync(staged.path),
      headers,
    );
  }

  let asset;
  try {
    asset = database.fetchAsset(assetId);
  } catch {
    return response(404);
  }
  if (asset.status !== "ready") {
    return response(404);
  }
  if (
    asset.kind === "chat_attachment" &&
    !asset.mimeType.startsWith("image/")
  ) {
    return response(415);
  }

  let path: string;
  try {
    path = assetService.resolveManagedPath(assetId);
  } catch {
    return response(400);
  }
  if (!existsSync(path)) {
    return response(404);
  }

  const headers = {
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Length": String(asset.byteSize),
    "Content-Type": asset.mimeType,
    "X-Content-Type-Options": "nosniff",
  };
  return response(200, request.method === "HEAD" ? null : readFileSync(path), headers);
}

export function registerAssetProtocol(
  database: DatabaseRuntime,
  assetService: AssetService,
): void {
  protocol.handle(ASSET_SCHEME, (request: Request) =>
    handleAssetRequest(request, database, assetService),
  );
}
