import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  config: text('config').notNull(),
  adminHash: text('admin_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const answers = sqliteTable('answers', {
  id: text('id').primaryKey(),
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slots: text('slots').notNull(),
  editHash: text('edit_hash').notNull().unique(),
  updatedAt: integer('updated_at').notNull(),
}, table => [index('answers_event_idx').on(table.eventId)]);

export const requestLimits = sqliteTable('request_limits', {
  id: text('id').primaryKey(),
  hits: integer('hits').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('request_limits_expiry_idx').on(table.expiresAt)]);
