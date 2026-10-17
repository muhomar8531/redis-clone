import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseResp, resp } from './resp.ts';
import { Store } from './store.ts';
import { PubSub } from './pubsub.ts';
import { executeCommand } from './commands.ts';

export function createRedisServer(): net.Server {
  const store = new Store();
  const pubsub = new PubSub();

  const server = net.createServer((socket) => {
    let buffer: Buffer = Buffer.alloc(0);

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length > 0) {
        const parsed = parseResp(buffer, 0);
        if (parsed === null) {
          break; // Wait for more TCP data
        }

        buffer = buffer.subarray(parsed.nextOffset);

        if (!Array.isArray(parsed.value)) {
          socket.write(resp.error('protocol error: expected array of arguments'));
          continue;
        }

        const args = parsed.value.map((item) => (item === null ? '' : String(item)));
        const response = executeCommand(args, socket, store, pubsub);
        if (response.length > 0 && !socket.destroyed) {
          socket.write(response);
        }
      }
    });

    socket.on('close', () => {
      pubsub.cleanup(socket);
    });

    socket.on('error', () => {
      pubsub.cleanup(socket);
    });
  });

  return server;
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const port = Number(process.env.PORT ?? 6379);
  const host = process.env.HOST ?? '127.0.0.1';
  const server = createRedisServer();

  server.listen(port, host, () => {
    console.log(`Mini Redis server listening on ${host}:${port}`);
  });
}
