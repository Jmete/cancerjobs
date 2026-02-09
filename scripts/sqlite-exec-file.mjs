#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_PATH = "data/cancerjobs.sqlite";

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const [key, valueFromEquals] = token.split("=");
    const normalizedKey = key.slice(2);

    if (valueFromEquals !== undefined) {
      parsed[normalizedKey] = valueFromEquals;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[normalizedKey] = next;
      index += 1;
      continue;
    }

    parsed[normalizedKey] = "true";
  }

  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node scripts/sqlite-exec-file.mjs --file <sql-file> [--db data/cancerjobs.sqlite]
`);
}

function resolveDbPath(rawPath) {
  const selectedPath =
    rawPath ??
    process.env.LOCAL_SQLITE_PATH ??
    process.env.SQLITE_DB_PATH ??
    DEFAULT_DB_PATH;

  if (path.isAbsolute(selectedPath)) return selectedPath;
  return path.join(process.cwd(), selectedPath);
}

function stripSqlComments(sqlText) {
  return sqlText
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("--")) return "";
      return line;
    })
    .join("\n");
}

function splitSqlStatements(sqlText) {
  const statements = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < sqlText.length; index += 1) {
    const char = sqlText[index];
    const next = sqlText[index + 1];

    if (char === "'" && !inDoubleQuote) {
      current += char;
      if (inSingleQuote && next === "'") {
        current += next;
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      current += char;
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === ";" && !inSingleQuote && !inDoubleQuote) {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }

    current += char;
  }

  const trailingStatement = current.trim();
  if (trailingStatement) statements.push(trailingStatement);

  return statements;
}

const args = parseArgs(process.argv.slice(2));
if (args.help === "true") {
  printUsage();
  process.exit(0);
}

const filePath = args.file;
if (!filePath) {
  console.error("Missing --file path.");
  printUsage();
  process.exit(1);
}

const resolvedSqlPath = path.resolve(filePath);
if (!fs.existsSync(resolvedSqlPath)) {
  console.error(`SQL file does not exist: ${resolvedSqlPath}`);
  process.exit(1);
}

const dbPath = resolveDbPath(args.db);
if (!fs.existsSync(dbPath)) {
  console.error(`SQLite DB does not exist: ${dbPath}`);
  console.error("Run `pnpm db:migrate` first.");
  process.exit(1);
}

const sqlText = fs.readFileSync(resolvedSqlPath, "utf8");
const statements = splitSqlStatements(stripSqlComments(sqlText));

if (statements.length === 0) {
  console.error("No executable SQL statements found.");
  process.exit(1);
}

const sqlite = new DatabaseSync(dbPath);
sqlite.exec("PRAGMA foreign_keys = ON;");

for (let index = 0; index < statements.length; index += 1) {
  const statementText = statements[index];
  console.log(`\nStatement ${index + 1}/${statements.length}`);

  const statement = sqlite.prepare(statementText);
  try {
    const rows = statement.all();
    if (rows.length > 0) {
      console.table(rows);
    } else {
      console.log("Query returned 0 rows.");
    }
  } catch {
    const result = statement.run();
    console.log(`changes=${result.changes ?? 0}`);
  }
}

console.log(`\nExecuted ${statements.length} statement(s) against ${dbPath}`);
