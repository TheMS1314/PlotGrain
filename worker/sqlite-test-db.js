import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

export function testDatabase() {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'))
  for (const { tag } of journal.entries) {
    raw.exec(readFileSync(new URL('../drizzle/' + tag + '.sql', import.meta.url), 'utf8'))
  }
  return {
    raw,
    async exec(sql) { raw.exec(sql) },
    prepare(sql) {
      const stmt = raw.prepare(sql)
      function bind(...values) {
        const numbered = sql.includes('?1')
        const params = numbered ? [Object.fromEntries(values.map((value, index) => ['?' + (index + 1), value]))] : values
        return {
          async first() { return stmt.get(...params) ?? null },
          async all() {
            const before = raw.prepare('SELECT total_changes() AS n').get().n
            const results = stmt.all(...params)
            const { n, last_row_id } = raw.prepare('SELECT total_changes() AS n, last_insert_rowid() AS last_row_id').get()
            return { results, meta: { changes: n - before, last_row_id } }
          },
          async run() { return { meta: { changes: stmt.run(...params).changes } } },
        }
      }
      return { bind, ...bind() }
    },
    async batch(statements) {
      raw.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.all())
        raw.exec('COMMIT')
        return results
      } catch (error) {
        raw.exec('ROLLBACK')
        throw error
      }
    },
  }
}
