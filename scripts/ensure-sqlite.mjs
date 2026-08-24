import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";

const databasePath = resolve("prisma/dev.sqlite");

if (!existsSync(databasePath)) {
  mkdirSync(dirname(databasePath), { recursive: true });
  closeSync(openSync(databasePath, "a", 0o600));
}
