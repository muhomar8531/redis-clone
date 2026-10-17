export type RespValue = string | number | null | RespValue[];

export interface ParseResult {
  value: RespValue;
  nextOffset: number;
}

function findCRLF(buffer: Buffer, offset: number): number {
  for (let i = offset; i < buffer.length - 1; i++) {
    if (buffer[i] === 13 && buffer[i + 1] === 10) {
      return i;
    }
  }
  return -1;
}

/**
 * Parses a single RESP2 frame (or inline command) starting at `offset`.
 * Returns `null` if the buffer does not yet contain a complete frame.
 */
export function parseResp(buffer: Buffer, offset = 0): ParseResult | null {
  if (offset >= buffer.length) {
    return null;
  }

  const lineEnd = findCRLF(buffer, offset);
  if (lineEnd === -1) {
    return null;
  }

  const prefix = String.fromCharCode(buffer[offset]);
  const line = buffer.subarray(offset + 1, lineEnd).toString('utf8');
  const nextLineStart = lineEnd + 2;

  switch (prefix) {
    case '+':
      return { value: line, nextOffset: nextLineStart };

    case '-':
      return { value: line, nextOffset: nextLineStart };

    case ':':
      return { value: parseInt(line, 10), nextOffset: nextLineStart };

    case '$': {
      const byteLength = parseInt(line, 10);
      if (byteLength < 0) {
        return { value: null, nextOffset: nextLineStart };
      }
      const endOfBulk = nextLineStart + byteLength;
      if (buffer.length < endOfBulk + 2) {
        return null; // Wait for full bulk string + trailing \r\n
      }
      const value = buffer.subarray(nextLineStart, endOfBulk).toString('utf8');
      return { value, nextOffset: endOfBulk + 2 };
    }

    case '*': {
      const count = parseInt(line, 10);
      if (count < 0) {
        return { value: null, nextOffset: nextLineStart };
      }
      const items: RespValue[] = [];
      let cursor = nextLineStart;
      for (let i = 0; i < count; i++) {
        const parsed = parseResp(buffer, cursor);
        if (parsed === null) {
          return null; // Wait for all array elements
        }
        items.push(parsed.value);
        cursor = parsed.nextOffset;
      }
      return { value: items, nextOffset: cursor };
    }

    default: {
      // Inline command fallback (e.g., "PING\r\n" or "SET foo bar\r\n" via nc/telnet)
      const fullLine = buffer.subarray(offset, lineEnd).toString('utf8').trim();
      const parts = fullLine.length > 0 ? fullLine.split(/\s+/) : [];
      return { value: parts, nextOffset: nextLineStart };
    }
  }
}

export const resp = {
  simpleString: (s: string): string => `+${s}\r\n`,
  error: (msg: string): string => `-ERR ${msg}\r\n`,
  integer: (n: number): string => `:${Math.trunc(n)}\r\n`,
  bulkString: (s: string | null): string =>
    s === null ? `$-1\r\n` : `$${Buffer.byteLength(s)}\r\n${s}\r\n`,
  array: (encodedItems: string[]): string =>
    `*${encodedItems.length}\r\n${encodedItems.join('')}`,
};
