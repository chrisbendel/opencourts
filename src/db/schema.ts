// Schema is the source of truth for **TypeScript types**.
// SQL migrations in `migrations/*.sql` are the source of truth for the
// **actual database**. Keep both in sync — when you change one, change the
// other in the same PR.

import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const courts = sqliteTable('courts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  location: text('location').notNull(),
  numCourts: integer('num_courts').notNull(),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch())`),
})

export const queueEntries = sqliteTable('queue_entries', {
  id: text('id').primaryKey(),
  courtId: text('court_id')
    .notNull()
    .references(() => courts.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  partySize: integer('party_size').notNull().default(1),
  status: text('status', { enum: ['waiting', 'playing'] }).notNull(),
  startedAt: integer('started_at'),
  expiresAt: integer('expires_at'),
})

// Derived types — change a column above and these update everywhere.
export type Court = typeof courts.$inferSelect
export type NewCourt = typeof courts.$inferInsert
export type QueueEntry = typeof queueEntries.$inferSelect
export type NewQueueEntry = typeof queueEntries.$inferInsert
