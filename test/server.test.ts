import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createRedisServer } from '../src/index.ts';
import { parseResp, resp, type RespValue } from '../src/resp.ts';

class TestRedisClient {
  private socket: net.Socket;
  private buffer: Buffer = Buffer.alloc(0);
  private pendingResolvers: Array<(val: RespValue) => void> = [];
  private queuedValues: RespValue[] = [];

  constructor(port: number) {
    this.socket = net.createConnection({ port, host: '127.0.0.1' });
    this.socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length > 0) {
        const parsed = parseResp(this.buffer, 0);
        if (!parsed) break;
        this.buffer = this.buffer.subarray(parsed.nextOffset);
        const resolver = this.pendingResolvers.shift();
        if (resolver) {
          resolver(parsed.value);
        } else {
          this.queuedValues.push(parsed.value);
        }
      }
    });
  }

  nextReply(): Promise<RespValue> {
    if (this.queuedValues.length > 0) {
      return Promise.resolve(this.queuedValues.shift()!);
    }
    return new Promise((resolve) => {
      this.pendingResolvers.push(resolve);
    });
  }

  sendCommand(...args: string[]): Promise<RespValue> {
    const encoded = resp.array(args.map((a) => resp.bulkString(a)));
    this.socket.write(encoded);
    return this.nextReply();
  }

  writeRaw(raw: string): void {
    this.socket.write(raw);
  }

  close(): void {
    this.socket.destroy();
  }
}

describe('Mini Redis TCP Server', () => {
  let server: net.Server;
  let port: number;

  before(async () => {
    server = createRedisServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('responds to COMMAND, PING, and ECHO', async () => {
    const client = new TestRedisClient(port);
    try {
      assert.deepEqual(await client.sendCommand('COMMAND', 'DOCS'), []);
      assert.equal(await client.sendCommand('PING'), 'PONG');
      assert.equal(await client.sendCommand('PING', 'hello'), 'hello');
      assert.equal(await client.sendCommand('ECHO', 'world'), 'world');
    } finally {
      client.close();
    }
  });

  it('supports SET, GET, and DEL', async () => {
    const client = new TestRedisClient(port);
    try {
      assert.equal(await client.sendCommand('GET', 'missing'), null);
      assert.equal(await client.sendCommand('SET', 'greeting', 'hello redis'), 'OK');
      assert.equal(await client.sendCommand('GET', 'greeting'), 'hello redis');
      assert.equal(await client.sendCommand('DEL', 'greeting', 'missing'), 1);
      assert.equal(await client.sendCommand('GET', 'greeting'), null);
    } finally {
      client.close();
    }
  });

  it('supports EXPIRE, TTL, and SET with PX/EX expiration', async () => {
    const client = new TestRedisClient(port);
    try {
      // Non-existent key TTL is -2
      assert.equal(await client.sendCommand('TTL', 'no_such_key'), -2);

      // Persistent key TTL is -1
      await client.sendCommand('SET', 'persist_key', 'val');
      assert.equal(await client.sendCommand('TTL', 'persist_key'), -1);

      // EXPIRE sets TTL in seconds
      assert.equal(await client.sendCommand('EXPIRE', 'persist_key', '1'), 1);
      const ttl = await client.sendCommand('TTL', 'persist_key');
      assert.equal(ttl, 1);

      // SET with PX expires quickly
      assert.equal(await client.sendCommand('SET', 'temp_key', 'ephemeral', 'PX', '80'), 'OK');
      assert.equal(await client.sendCommand('GET', 'temp_key'), 'ephemeral');

      await new Promise((r) => setTimeout(r, 120));
      assert.equal(await client.sendCommand('GET', 'temp_key'), null);
      assert.equal(await client.sendCommand('TTL', 'temp_key'), -2);
    } finally {
      client.close();
    }
  });

  it('handles fragmented and pipelined RESP frames over TCP', async () => {
    const client = new TestRedisClient(port);
    try {
      // Send a command split across two writes
      client.writeRaw('*3\r\n$3\r\nSET\r\n$4\r\nfrag');
      await new Promise((r) => setTimeout(r, 20));
      client.writeRaw('\r\n$5\r\nvalue\r\n');
      assert.equal(await client.nextReply(), 'OK');
      assert.equal(await client.sendCommand('GET', 'frag'), 'value');

      // Send two pipelined commands in a single write
      client.writeRaw('*1\r\n$4\r\nPING\r\n*2\r\n$3\r\nGET\r\n$4\r\nfrag\r\n');
      assert.equal(await client.nextReply(), 'PONG');
      assert.equal(await client.nextReply(), 'value');
    } finally {
      client.close();
    }
  });

  it('supports SUBSCRIBE, PUBLISH, and UNSUBSCRIBE across clients', async () => {
    const subClient = new TestRedisClient(port);
    const pubClient = new TestRedisClient(port);

    try {
      const subAck = await subClient.sendCommand('SUBSCRIBE', 'chat');
      assert.deepEqual(subAck, ['subscribe', 'chat', 1]);

      const delivered = await pubClient.sendCommand('PUBLISH', 'chat', 'hello channel!');
      assert.equal(delivered, 1);

      const pushedMsg = await subClient.nextReply();
      assert.deepEqual(pushedMsg, ['message', 'chat', 'hello channel!']);

      const unsubAck = await subClient.sendCommand('UNSUBSCRIBE', 'chat');
      assert.deepEqual(unsubAck, ['unsubscribe', 'chat', 0]);

      const deliveredAfterUnsub = await pubClient.sendCommand('PUBLISH', 'chat', 'no one listening');
      assert.equal(deliveredAfterUnsub, 0);
    } finally {
      subClient.close();
      pubClient.close();
    }
  });
});
