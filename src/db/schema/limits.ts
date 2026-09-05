import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The fixed-window mutation counter (D69). One row per subject, bucket and window.
 *
 * `subject_id` is the session's user id — never an IP, and never anything the client sends.
 * Every mutation in this app is behind Google OAuth and an admin approval, so there is no
 * anonymous surface to protect, and an IP key would throttle two members on one home network
 * as though they were one person.
 *
 * `bucket` is text rather than a pgEnum on purpose: unlike `job_name`, which the health page
 * reads and renders, nothing outside `src/server/limits/policy.ts` interprets this column, and
 * an enum would need a migration every time a bucket is added.
 *
 * No foreign key to `users`. A row here is a counter, not a record — cascading a user delete
 * into rate-limit history is noise, and the counter must keep working during any moment the
 * users table is locked.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    subjectId: uuid('subject_id').notNull(),
    bucket: text('bucket').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.subjectId, t.bucket, t.windowStart] })],
);
