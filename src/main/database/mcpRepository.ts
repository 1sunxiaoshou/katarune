import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { mcpServerConfigSchema } from "../../shared/mcp";
import { mcpServers } from "./schema";
import type { KataruneDatabase } from "./types";

const storedMcpServerSchema = mcpServerConfigSchema.extend({ credentialRef: z.string().nullable() });
export type StoredMcpServer = z.infer<typeof storedMcpServerSchema>;

export function createMcpRepository(database: KataruneDatabase) {
  const listMcpConfigs = (): StoredMcpServer[] => database.select().from(mcpServers).orderBy(asc(mcpServers.name), asc(mcpServers.id)).all()
    .map(row => storedMcpServerSchema.parse({ ...row, transport: row.transport }));
  return {
    listMcpConfigs,
    fetchMcpConfig(id: string): StoredMcpServer {
      const row = database.select().from(mcpServers).where(eq(mcpServers.id, id)).get();
      if (!row) throw new Error("MCP 服务不存在。");
      return storedMcpServerSchema.parse(row);
    },
    saveMcpConfig(value: StoredMcpServer): void {
      const config = storedMcpServerSchema.parse(value);
      database.insert(mcpServers).values(config).onConflictDoUpdate({ target: mcpServers.id, set: config }).run();
    },
    deleteMcpConfig(id: string): void {
      database.delete(mcpServers).where(eq(mcpServers.id, id)).run();
    },
  };
}
