CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`issue_id` integer,
	`run_id` text,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`actor` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_project_issue_idx` ON `events` (`project_id`,`issue_id`);--> statement-breakpoint
CREATE TABLE `issues` (
	`project_id` text NOT NULL,
	`id` integer NOT NULL,
	`state` text NOT NULL,
	`held_reason` text,
	`verify_round` integer DEFAULT 0 NOT NULL,
	`qa_round` integer DEFAULT 0 NOT NULL,
	`review_iter` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`project_id`, `id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`day` text NOT NULL,
	`cost_usd` real,
	`cost_unknown` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`method` text DEFAULT 'agile' NOT NULL,
	`profile` text,
	CONSTRAINT "projects_method_check" CHECK("projects"."method" IN ('agile', 'lens'))
);
--> statement-breakpoint
CREATE TABLE `run_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_results_run_kind_idx` ON `run_results` (`run_id`,`kind`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`issue_id` integer NOT NULL,
	`phase` text,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TRIGGER `events_no_update` BEFORE UPDATE ON `events` BEGIN SELECT RAISE(ABORT, 'events é append-only: UPDATE recusado'); END;
--> statement-breakpoint
CREATE TRIGGER `events_no_delete` BEFORE DELETE ON `events` BEGIN SELECT RAISE(ABORT, 'events é append-only: DELETE recusado'); END;
