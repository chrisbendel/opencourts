import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

/**
 * Build a per-request Drizzle instance bound to the given D1 database.
 *
 * D1's binding is request-scoped — `env.DB` is plumbed through the Worker's
 * `env` argument and is not available at module load time. Construct the
 * Drizzle instance inside the server-function handler:
 *
 *   const db = makeDb(env.DB)
 *
 * Never store the result on a module-level variable.
 */
export function makeDb(d1: D1Database) {
  return drizzle(d1, { schema })
}

export type Db = ReturnType<typeof makeDb>
