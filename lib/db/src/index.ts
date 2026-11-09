import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sqliteSchema } from "./schema";

const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
const configuredPath = process.env.SQLITE_PATH;
const databasePath = path.resolve(
  configuredPath ||
    (volumePath
      ? path.join(volumePath, "telegram.sqlite")
      : path.join(process.cwd(), "data", "telegram.sqlite")),
);

mkdirSync(path.dirname(databasePath), { recursive: true });

const sqlite = new DatabaseSync(databasePath);
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA busy_timeout = 5000");
sqlite.exec(sqliteSchema);

type SqlValue = null | string | number | bigint | Uint8Array;
type QueryResult<T> = { rows: T[]; rowCount: number };
type Query = <T = Record<string, unknown>>(
  sql: string,
  values?: unknown[],
) => Promise<QueryResult<T>>;

function toSqlValue(value: unknown): SqlValue {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  throw new Error("Unsupported SQLite query parameter.");
}

const query: Query = async <T>(
  sql: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> => {
  const statementText = sql.replace(/\$(\d+)/g, "?$1");
  const parameters = values.map(toSqlValue);
  const command = statementText.trim().toUpperCase();

  if (command === "BEGIN") {
    sqlite.exec("BEGIN IMMEDIATE");
    return { rows: [], rowCount: 0 };
  }
  if (command === "COMMIT" || command === "ROLLBACK") {
    sqlite.exec(command);
    return { rows: [], rowCount: 0 };
  }

  const statement = sqlite.prepare(statementText);
  const returnsRows =
    /^\s*(SELECT|PRAGMA|WITH)\b/i.test(statementText) ||
    /\bRETURNING\b/i.test(statementText);
  if (returnsRows) {
    const rows = statement.all(...parameters) as T[];
    return { rows, rowCount: rows.length };
  }

  const result = statement.run(...parameters);
  return { rows: [], rowCount: Number(result.changes) };
};

export const pool = {
  query,
  async connect() {
    return {
      query,
      release() {},
    };
  },
};

export { sqlite };
