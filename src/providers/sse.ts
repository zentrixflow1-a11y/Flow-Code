/**
 * A Server-Sent Events decoder.
 *
 * The decoder is deliberately independent of any HTTP client: it takes string
 * chunks and yields parsed records, which makes it trivial to test against
 * hand-written fixtures — including the awkward cases that break naive
 * parsers, like a record split across a chunk boundary.
 */

/** One parsed Server-Sent Event. */
export interface SseRecord {
  /** The `event:` field, when the stream supplied one. */
  readonly event?: string;
  /** The `data:` payload, with multiple data lines joined by newlines. */
  readonly data: string;
  /** The `id:` field, when the stream supplied one. */
  readonly id?: string;
}

/**
 * An incremental Server-Sent Events decoder.
 *
 * Feed it chunks with {@link SseDecoder.push} and it returns whichever
 * complete records those chunks finished.
 */
export class SseDecoder {
  #buffer = "";

  /**
   * Feed a chunk of the stream and return the records it completed.
   *
   * @param chunk - The next slice of the response body.
   */
  push(chunk: string): SseRecord[] {
    this.#buffer += chunk;
    const records: SseRecord[] = [];

    // A record ends at a blank line. Both "\n\n" and "\r\n\r\n" are valid
    // line terminators, and a stream may mix them.
    let separator = this.#findSeparator();
    while (separator !== undefined) {
      const block = this.#buffer.slice(0, separator.index);
      this.#buffer = this.#buffer.slice(separator.index + separator.length);
      const record = this.#parseBlock(block);
      if (record !== undefined) {
        records.push(record);
      }
      separator = this.#findSeparator();
    }

    return records;
  }

  /**
   * Finish decoding, returning any trailing record that never got its blank
   * line.
   */
  flush(): SseRecord[] {
    const remainder = this.#buffer;
    this.#buffer = "";
    if (remainder.trim() === "") {
      return [];
    }
    const record = this.#parseBlock(remainder);
    return record === undefined ? [] : [record];
  }

  /** Find the next record separator in the buffer. */
  #findSeparator(): { readonly index: number; readonly length: number } | undefined {
    const lf = this.#buffer.indexOf("\n\n");
    const crlf = this.#buffer.indexOf("\r\n\r\n");

    if (lf === -1 && crlf === -1) {
      return undefined;
    }
    if (crlf !== -1 && (lf === -1 || crlf < lf)) {
      return { index: crlf, length: 4 };
    }
    return { index: lf, length: 2 };
  }

  /** Parse one record's worth of lines. */
  #parseBlock(block: string): SseRecord | undefined {
    let event: string | undefined;
    let id: string | undefined;
    const dataLines: string[] = [];

    for (const rawLine of block.split(/\r?\n/)) {
      if (rawLine === "" || rawLine.startsWith(":")) {
        // Blank lines and comments carry no data.
        continue;
      }

      const colon = rawLine.indexOf(":");
      const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
      let value = colon === -1 ? "" : rawLine.slice(colon + 1);
      // A single leading space after the colon is part of the framing.
      if (value.startsWith(" ")) {
        value = value.slice(1);
      }

      switch (field) {
        case "data":
          dataLines.push(value);
          break;
        case "event":
          event = value;
          break;
        case "id":
          id = value;
          break;
        default:
          // `retry:` and unknown fields are ignored.
          break;
      }
    }

    if (dataLines.length === 0 && event === undefined) {
      return undefined;
    }

    return {
      ...(event === undefined ? {} : { event }),
      ...(id === undefined ? {} : { id }),
      data: dataLines.join("\n"),
    };
  }
}
