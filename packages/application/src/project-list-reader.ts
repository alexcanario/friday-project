/** Read-only view of the projects the daemon processes. */
export interface ProjectListReader {
  /** Project ids in ascending order. */
  list(): string[];
}
