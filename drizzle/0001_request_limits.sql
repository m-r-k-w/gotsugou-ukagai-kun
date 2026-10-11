CREATE TABLE `request_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`hits` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `request_limits_expiry_idx` ON `request_limits` (`expires_at`);