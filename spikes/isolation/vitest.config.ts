import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// C9 inspects what the other Docker files left behind, so its file must run after them.
class CleanupLast extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    const isCleanup = (file: TestSpecification) => file.moduleId.endsWith("cleanup.test.ts");
    return [...sorted.filter((file) => !isCleanup(file)), ...sorted.filter(isCleanup)];
  }
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
    // Docker tests share one daemon and the cleanup test inspects it: run files one by one.
    fileParallelism: false,
    sequence: { sequencer: CleanupLast },
  },
});
