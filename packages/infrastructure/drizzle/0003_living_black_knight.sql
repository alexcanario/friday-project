CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`issue_id` integer NOT NULL,
	`pr` integer NOT NULL,
	`head_sha` text NOT NULL,
	`tier` text NOT NULL,
	`requested_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`decision` text,
	`decided_at` integer,
	`decided_by` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
