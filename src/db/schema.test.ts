// @vitest-environment node
//
// Schema drift check.
//
// Compares the columns Drizzle thinks exist (from `src/db/schema.ts`) to the
// columns actually present in the local D1 SQLite file (after migrations
// have been applied). Catches the "I changed the migration but forgot the
// schema.ts" class of bug.
//
// What it catches: column name drift, missing tables in either source.
// What it doesn't catch: type mismatches, nullability/default drift, index
// drift. Those surface fast at runtime; not worth the parser complexity here.
//
// Runs via `pnpm test` (or `pnpm db:check`). Requires `pnpm db:migrate` to
// have run first — the test skips with a clear message otherwise.

import { execSync } from 'node:child_process'

import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import * as schema from './schema'

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

const INTERNAL_TABLES = new Set([
  'd1_migrations',
  '_cf_METADATA',
  'sqlite_sequence',
])

interface DbTable {
  name: string
  sql: string
}

function tryGetDbTables(): DbTable[] | null {
  try {
    const raw = execSync(
      `npx wrangler d1 execute opencourts --local --json --command "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    // wrangler --json emits one or more JSON envelopes; the tables payload is
    // an array of result blocks, each with a `results` array.
    const start = raw.indexOf('[')
    if (start === -1) return null
    const parsed = JSON.parse(raw.slice(start))
    const rows = parsed[0]?.results as DbTable[] | undefined
    if (!rows) return null
    return rows.filter((t) => !INTERNAL_TABLES.has(t.name))
  } catch {
    return null
  }
}

/**
 * Parses column names out of a `CREATE TABLE foo (...)` statement.
 * Crude but effective for SQLite: we only care about the leading identifier
 * of each top-level item inside the parens, skipping CONSTRAINT / FOREIGN KEY
 * etc.
 */
function parseColumnNames(createSql: string): string[] {
  const open = createSql.indexOf('(')
  const close = createSql.lastIndexOf(')')
  if (open < 0 || close < 0) return []
  const inner = createSql.slice(open + 1, close)

  const items: string[] = []
  let depth = 0
  let acc = ''
  for (const ch of inner) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      items.push(acc.trim())
      acc = ''
    } else {
      acc += ch
    }
  }
  if (acc.trim()) items.push(acc.trim())

  const skipKeywords = new Set([
    'constraint',
    'foreign',
    'primary',
    'unique',
    'check',
  ])
  return items
    .map((item) => item.replace(/^["`[]?(\w+)["`\]]?.*$/s, '$1'))
    .filter((name) => name && !skipKeywords.has(name.toLowerCase()))
}

interface TsTable {
  name: string // SQL table name (snake_case)
  columns: string[] // SQL column names (snake_case)
}

function getTsTables(): TsTable[] {
  const tables: TsTable[] = []
  for (const value of Object.values(schema)) {
    // Drizzle table objects have a Symbol marker. Easier check: getTableConfig
    // throws on non-tables; try/skip.
    try {
      const cfg = getTableConfig(value as never)
      tables.push({
        name: cfg.name,
        columns: cfg.columns.map((c) => c.name).sort(),
      })
    } catch {
      // not a Drizzle table — skip
    }
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name))
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

describe('schema ↔ migrations drift check', () => {
  const dbTables = tryGetDbTables()

  if (!dbTables) {
    it.skip("local D1 not available — run 'pnpm db:migrate' first", () => {})
    return
  }

  const tsTables = getTsTables()

  it('every Drizzle table exists in the local D1', () => {
    const dbNames = new Set(dbTables.map((t) => t.name))
    const missing = tsTables
      .filter((t) => !dbNames.has(t.name))
      .map((t) => t.name)
    expect(
      missing,
      `Drizzle schema declares tables that are not in local D1: ${missing.join(
        ', ',
      )}\nDid you forget to write/apply a migration?`,
    ).toEqual([])
  })

  it('every D1 table has a Drizzle declaration', () => {
    const tsNames = new Set(tsTables.map((t) => t.name))
    const missing = dbTables
      .filter((t) => !tsNames.has(t.name))
      .map((t) => t.name)
    expect(
      missing,
      `Local D1 has tables not declared in src/db/schema.ts: ${missing.join(
        ', ',
      )}\nAdd them to schema.ts or remove them via a migration.`,
    ).toEqual([])
  })

  it.each(tsTables)('columns of "$name" match between schema and D1', (ts) => {
    const dbTable = dbTables.find((t) => t.name === ts.name)
    if (!dbTable) {
      // Already reported by the existence test above. Fail soft here.
      return
    }
    const dbCols = parseColumnNames(dbTable.sql).sort()
    expect(
      dbCols,
      `Column drift in "${ts.name}":\n` +
        `  schema.ts: ${ts.columns.join(', ')}\n` +
        `  D1:        ${dbCols.join(', ')}`,
    ).toEqual(ts.columns)
  })
})
