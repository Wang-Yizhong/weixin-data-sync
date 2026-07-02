import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mysql, { type PoolConnection } from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env"), quiet: true });

function getDatabaseConfig(): mysql.PoolOptions {
  const databaseUrl = process.env.DEV_DATABASE_URL ?? process.env.DATABASE_URL;

  if (databaseUrl) {
    return {
      uri: databaseUrl,
      multipleStatements: false,
    };
  }

  return {
    host: process.env.DEV_MYSQL_HOST ?? process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.DEV_MYSQL_PORT ?? process.env.MYSQL_PORT ?? 3306),
    user: process.env.DEV_MYSQL_USER ?? process.env.MYSQL_USER,
    password: process.env.DEV_MYSQL_PASSWORD ?? process.env.MYSQL_PASSWORD,
    database: process.env.DEV_MYSQL_DATABASE ?? process.env.MYSQL_DATABASE,
    multipleStatements: false,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getCurrentDatabaseName(connection: PoolConnection): Promise<string | null> {
  const [rows] = await connection.query("SELECT DATABASE() AS database_name");
  const firstRow = Array.isArray(rows) ? rows[0] : null;

  if (isObject(firstRow) && typeof firstRow.database_name === "string") {
    return firstRow.database_name;
  }

  return null;
}

function assertDevDatabase(databaseName: string | null): void {
  const normalized = (databaseName ?? "").toLowerCase();

  if (!normalized.includes("dev") || normalized.includes("prod")) {
    throw new Error(`安全校验失败：当前数据库名为 ${databaseName ?? "<null>"}，必须包含 dev 且不能包含 prod`);
  }
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .replace(/^\uFEFF/, "")
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function assertSafeSchemaSql(sql: string): void {
  if (/\bDROP\b/i.test(sql) || /\bTRUNCATE\b/i.test(sql)) {
    throw new Error("安全校验失败：schema SQL 中不允许出现 DROP 或 TRUNCATE");
  }
}

async function columnExists(connection: PoolConnection, tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName],
  );
  const firstRow = Array.isArray(rows) ? rows[0] : null;

  return isObject(firstRow) && Number(firstRow.count) > 0;
}

async function indexExists(connection: PoolConnection, tableName: string, indexName: string): Promise<boolean> {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [tableName, indexName],
  );
  const firstRow = Array.isArray(rows) ? rows[0] : null;

  return isObject(firstRow) && Number(firstRow.count) > 0;
}

async function ensureAuthorGroupColumn(connection: PoolConnection): Promise<boolean> {
  const exists = await columnExists(connection, "wechat_articles", "author_group");

  if (exists) {
    return false;
  }

  await connection.query(
    "ALTER TABLE wechat_articles ADD COLUMN author_group VARCHAR(64) NOT NULL DEFAULT '未知作者' COMMENT '作者归类' AFTER article_author",
  );

  return true;
}

async function ensureAuthorGroupIndex(connection: PoolConnection): Promise<boolean> {
  const exists = await indexExists(connection, "wechat_articles", "idx_author_group");

  if (exists) {
    return false;
  }

  await connection.query("ALTER TABLE wechat_articles ADD KEY idx_author_group (author_group)");
  return true;
}

async function main(): Promise<void> {
  const schemaPath = resolve(process.cwd(), "database/schema/wechat_articles.sql");
  const sql = readFileSync(schemaPath, "utf8");
  assertSafeSchemaSql(sql);

  const connection = await mysql.createConnection(getDatabaseConfig());

  try {
    const databaseName = await getCurrentDatabaseName(connection);
    console.log(`当前数据库：${databaseName ?? "<null>"}`);
    assertDevDatabase(databaseName);
    console.log("安全校验通过：当前数据库名包含 dev，且不包含 prod。");

    const statements = splitSqlStatements(sql);
    for (const statement of statements) {
      await connection.query(statement);
    }

    const addedAuthorGroupColumn = await ensureAuthorGroupColumn(connection);
    const addedAuthorGroupIndex = await ensureAuthorGroupIndex(connection);

    console.log("建表完成：wechat_articles / wechat_article_assets / article_categories");
    console.log(`author_group 字段：${addedAuthorGroupColumn ? "已新增" : "已存在"}`);
    console.log(`idx_author_group 索引：${addedAuthorGroupIndex ? "已新增" : "已存在"}`);
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error("dev 数据库建表失败：");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
