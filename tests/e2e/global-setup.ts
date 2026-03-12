import fs from "node:fs/promises";
import path from "node:path";

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // Ignore: cleanup is best-effort.
  }
}

async function globalSetup(): Promise<void> {
  const dbPath = process.env.E2E_DB_PATH || path.join(process.cwd(), ".tmp", "vmill-e2e.db");
  const tmpDir = path.dirname(dbPath);
  await fs.mkdir(tmpDir, { recursive: true });
  await removeIfExists(dbPath);
  await removeIfExists(`${dbPath}-shm`);
  await removeIfExists(`${dbPath}-wal`);
}

export default globalSetup;

