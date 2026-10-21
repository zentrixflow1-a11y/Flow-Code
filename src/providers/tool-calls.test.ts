import { describe, expect, it } from "vitest";
import { ToolCallAssembler } from "./tool-calls.js";

describe("ToolCallAssembler", () => {
  it("assembles a call whose name and arguments arrive separately", () => {
    const assembler = new ToolCallAssembler();
    assembler.add({ index: 0, id: "call_1", name: "read_file", argumentsDelta: "" });
    assembler.add({ index: 0, argumentsDelta: '{"path":"a.ts"}' });

    expect(assembler.complete()).toEqual([
      { id: "call_1", name: "read_file", args: { path: "a.ts" } },
    ]);
  });

  it("assembles a call whose arguments arrive in many fragments", () => {
    const assembler = new ToolCallAssembler();
    assembler.add({ index: 0, id: "call_1", name: "read_file" });
    for (const piece of ['{"pa', 'th":"a', '.ts"}']) {
      assembler.add({ index: 0, argumentsDelta: piece });
    }

    expect(assembler.complete()[0]?.args).toEqual({ path: "a.ts" });
  });

  it("keeps several calls apart by index", () => {
    const assembler = new ToolCallAssembler();
    assembler.add({ index: 0, id: "a", name: "first", argumentsDelta: "{}" });
    assembler.add({ index: 1, id: "b", name: "second", argumentsDelta: "{}" });

    const calls = assembler.complete();
    expect(calls.map((call) => call.name)).toEqual(["first", "second"]);
  });

  it("accepts fragments that arrive out of order", () => {
    const assembler = new ToolCallAssembler();
    assembler.add({ index: 1, id: "b", name: "second" });
    assembler.add({ index: 0, id: "a", name: "first" });
    assembler.add({ index: 1, argumentsDelta: "{}" });
    assembler.add({ index: 0, argumentsDelta: "{}" });

    // The order follows the first fragment each call produced.
    expect(assembler.complete().map((call) => call.name)).toEqual(["second", "first"]);
  });

  it("treats empty arguments as an empty object", () => {
    const assembler = new ToolCallAssembler();
    assembler.add({ index: 0, id: "a", name: "noop", argumentsDelta: "" });
    expect(assembler.complete()[0]?.args).toEqual({});
  });

  it("reports arguments that are not valid JSON", () => {
    const assembler = new ToolCallAssembler();
    assembler.add({ index: 0, id: "a", name: "read_file", argumentsDelta: "{not json" });

    expect(assembler.malformed()).toHaveLength(1);
    expect(assembler.malformed()[0]?.error.code).toBe("malformed_response");
  });

  it("does not report empty arguments as malformed", () => {
    const assembler = new ToolCallAssembler();
    assembler.add({ index: 0, id: "a", name: "noop" });
    expect(assembler.malformed()).toEqual([]);
  });

  it("ignores empty ids and names in later fragments", () => {
    const assembler = new ToolCallAssembler();
    assembler.add({ index: 0, id: "call_1", name: "read_file" });
    assembler.add({ index: 0, id: "", name: "", argumentsDelta: "{}" });

    expect(assembler.complete()[0]).toEqual({
      id: "call_1",
      name: "read_file",
      args: {},
    });
  });

  it("returns nothing when no calls were seen", () => {
    expect(new ToolCallAssembler().complete()).toEqual([]);
  });
});
