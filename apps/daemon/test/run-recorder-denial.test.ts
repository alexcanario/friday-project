import { describe, expect, it } from "vitest";
import { createRedactor, createRunRecorder } from "../src/index.ts";
import { FakeEvents, FakeIssueRepository } from "./fakes.ts";

const AT = "2026-11-05T03:00:00.000Z";
const CTX = { runId: "r1", issueId: 7 };
const identity = (text: string): string => text;

function setup(redact?: (text: string) => string) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events);
  const recorder = createRunRecorder({
    projectId: "p",
    events,
    issues,
    now: () => new Date(AT),
    ...(redact ? { redact } : {}),
  });
  return { events, sink: recorder.denialSink(CTX) };
}

describe("run recorder denial details", () => {
  it("appends reason and target and omits absent keys", () => {
    const { events, sink } = setup(identity);
    sink.record({ toolName: "Read", toolUseId: "t1", reason: "r", target: "/p" });
    sink.record({ toolName: "Read", toolUseId: "t2" });
    expect(events.appended).toEqual([
      {
        type: "ToolDenied",
        projectId: "p",
        issueId: 7,
        runId: "r1",
        actor: "daemon",
        at: AT,
        payload: { toolName: "Read", toolUseId: "t1", reason: "r", target: "/p" },
      },
      {
        type: "ToolDenied",
        projectId: "p",
        issueId: 7,
        runId: "r1",
        actor: "daemon",
        at: AT,
        payload: { toolName: "Read", toolUseId: "t2" },
      },
    ]);
    expect(Object.keys(events.appended[1]?.payload as object)).toEqual(["toolName", "toolUseId"]);
  });

  it("truncates reason and target at 200 characters", () => {
    const { events, sink } = setup(identity);
    sink.record({
      toolName: "Bash",
      toolUseId: "t1",
      reason: "r".repeat(201),
      target: "t".repeat(201),
    });
    sink.record({
      toolName: "Bash",
      toolUseId: "t2",
      reason: "r".repeat(200),
      target: "t".repeat(200),
    });
    expect(events.appended[0]?.payload).toEqual({
      toolName: "Bash",
      toolUseId: "t1",
      reason: "r".repeat(199) + "…",
      target: "t".repeat(199) + "…",
    });
    expect(events.appended[1]?.payload).toEqual({
      toolName: "Bash",
      toolUseId: "t2",
      reason: "r".repeat(200),
      target: "t".repeat(200),
    });
  });

  it("masks a token in the target", () => {
    const { events, sink } = setup((text) => text.replace(/ghp_[A-Za-z0-9]+/g, "***"));
    sink.record({ toolName: "Bash", toolUseId: "t1", target: "cat ghp_abc123" });
    expect(events.appended[0]?.payload).toEqual({
      toolName: "Bash",
      toolUseId: "t1",
      target: "cat ***",
    });
  });

  it("redacts before truncating", () => {
    const { events, sink } = setup(createRedactor({ ANTHROPIC_API_KEY: "SECRETVALUE123" }));
    sink.record({
      toolName: "Bash",
      toolUseId: "t1",
      target: "x".repeat(190) + "SECRETVALUE123",
    });
    expect(events.appended[0]?.payload).toEqual({
      toolName: "Bash",
      toolUseId: "t1",
      target: "x".repeat(190) + "***",
    });
  });

  it("omits reason and target without a redactor", () => {
    const { events, sink } = setup();
    sink.record({ toolName: "Bash", toolUseId: "t1", reason: "r", target: "cat ghp_abc123" });
    expect(events.appended[0]?.payload).toEqual({ toolName: "Bash", toolUseId: "t1" });
  });
});
