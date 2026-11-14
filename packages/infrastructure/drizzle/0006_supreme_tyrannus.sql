CREATE TABLE `project_enabled` (
	`project_id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
