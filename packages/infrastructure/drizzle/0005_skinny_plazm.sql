CREATE TABLE `breaker_state` (
	`project_id` text PRIMARY KEY NOT NULL,
	`opened_at` text,
	`failures_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
