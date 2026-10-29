import { readFileSync, statSync } from "node:fs";
import { protocol } from "electron";
import type { DatabaseRuntime } from "../database/database";
import type { AssetService } from "./assetService";
import { diagnostic } from "../diagnostics/logger";
import { OperationRejected } from "../diagnostics/operationRejected";
import { projectError, type RejectionCode } from "../../shared/diagnostics";

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

function rejected(status: number, reasonCode: RejectionCode, headers?: HeadersInit): Response {
  diagnostic("warn", "asset.request-rejected", { outcome: "rejected", reasonCode });
  return response(status, null, headers);
}

function failed(error: unknown): Response {
  diagnostic("error", "asset.request-failed", { outcome: "failed" }, error);
  return response(500);
}

export function handleAssetRequest(
  request: Request,
  database: DatabaseRuntime,
  assetService: AssetService,
): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return rejected(405, "method-not-allowed", { Allow: "GET, HEAD" });
  }

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return rejected(400, "invalid-input");
  }
  const assetId = url.pathname.slice(1);
  if (
    url.hostname !== "asset" ||
    url.search !== "" ||
    url.hash !== "" ||
    !UUID_PATTERN.test(assetId)
  ) {
    return rejected(400, "invalid-input");
  }

  let asset;
  try {
    asset = database.fetchAsset(assetId);
  } catch (error) {
    return error instanceof OperationRejected && error.reasonCode === "resource-unavailable"
      ? rejected(404, error.reasonCode) : failed(error);
  }
  if (asset.status !== "ready") {
    return rejected(404, "resource-unavailable");
  }
  if (
    !asset.mimeType.startsWith("image/")
  ) {
    return rejected(415, "unsupported-media");
  }

  let path: string;
  try {
    path = assetService.resolveManagedPath(assetId);
  } catch (error) {
    // A validated UUID cannot escape the managed root: a resolver failure is internal.
    return failed(error);
  }

  const headers = {
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Length": String(asset.byteSize),
    "Content-Type": asset.mimeType,
    "X-Content-Type-Options": "nosniff",
  };
  try {
    if (request.method === "HEAD") { statSync(path); return response(200, null, headers); }
    return response(200, readFileSync(path), headers);
  } catch (error) {
    return projectError(error).code === "ENOENT" ? rejected(404, "resource-unavailable") : failed(error);
  }
}

export function registerAssetProtocol(
  database: DatabaseRuntime,
  assetService: AssetService,
): void {
  protocol.handle(ASSET_SCHEME, (request: Request) =>
    handleAssetRequest(request, database, assetService),
  );
}
