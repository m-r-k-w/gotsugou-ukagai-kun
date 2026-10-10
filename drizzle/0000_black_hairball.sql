CREATE TABLE `answers` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`slots` text NOT NULL,
	`edit_hash` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `answers_edit_hash_unique` ON `answers` (`edit_hash`);--> statement-breakpoint
CREATE INDEX `answers_event_idx` ON `answers` (`event_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`config` text NOT NULL,
	`admin_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
