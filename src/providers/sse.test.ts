import { describe, expect, it } from "vitest";
import { SseDecoder } from "./sse.js";

describe("SseDecoder", () => {
  it("decodes a single record", () => {
    const decoder = new SseDecoder();
    const records = decoder.push("data: hello\n\n");
    expect(records).toEqual([{ data: "hello" }]);
  });

  it("decodes several records from one chunk", () => {
    const decoder = new SseDecoder();
    const records = decoder.push("data: one\n\ndata: two\n\n");
    expect(records.map((record) => record.data)).toEqual(["one", "two"]);
  });

  it("waits for the record to be complete", () => {
    const decoder = new SseDecoder();
    expect(decoder.push("data: hel")).toEqual([]);
    expect(decoder.push("lo\n\n")).toEqual([{ data: "hello" }]);
  });

  it("joins several data lines with newlines", () => {
    const decoder = new SseDecoder();
    const records = decoder.push("data: one\ndata: two\n\n");
    expect(records[0]?.data).toBe("one\ntwo");
  });

  it("ignores comment lines", () => {
    const decoder = new SseDecoder();
    const records = decoder.push(": keep-alive\ndata: hello\n\n");
    expect(records).toEqual([{ data: "hello" }]);
  });

  it("handles carriage-return line endings", () => {
    const decoder = new SseDecoder();
    const records = decoder.push("data: hello\r\n\r\n");
    expect(records).toEqual([{ data: "hello" }]);
  });

  it("reads the event and id fields", () => {
    const decoder = new SseDecoder();
    const records = decoder.push("event: ping\nid: 7\ndata: hello\n\n");
    expect(records[0]).toEqual({ event: "ping", id: "7", data: "hello" });
  });

  it("strips only one leading space from a value", () => {
    const decoder = new SseDecoder();
    const records = decoder.push("data:  padded\n\n");
    expect(records[0]?.data).toBe(" padded");
  });

  it("ignores unknown fields", () => {
    const decoder = new SseDecoder();
    const records = decoder.push("retry: 500\ndata: hello\n\n");
    expect(records).toEqual([{ data: "hello" }]);
  });

  it("returns a trailing record on flush", () => {
    const decoder = new SseDecoder();
    expect(decoder.push("data: hello")).toEqual([]);
    expect(decoder.flush()).toEqual([{ data: "hello" }]);
  });

  it("flushes nothing when the buffer is empty", () => {
    const decoder = new SseDecoder();
    expect(decoder.flush()).toEqual([]);
  });

  it("reassembles a record split across many chunks", () => {
    const decoder = new SseDecoder();
    const pieces = ["data: {\"a\"", ":1}\n", "\n"];
    const records = pieces.flatMap((piece) => decoder.push(piece));
    expect(records).toEqual([{ data: '{"a":1}' }]);
  });
});
