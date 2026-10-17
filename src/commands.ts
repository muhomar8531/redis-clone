import type { Socket } from 'node:net';
import { resp } from './resp.ts';
import type { Store } from './store.ts';
import type { PubSub } from './pubsub.ts';

export function executeCommand(
  args: string[],
  socket: Socket,
  store: Store,
  pubsub: PubSub
): string {
  if (args.length === 0) {
    return '';
  }

  const cmd = args[0].toUpperCase();

  switch (cmd) {
    case 'COMMAND':
      // Sent by redis-cli upon connection; empty array keeps startup clean
      return resp.array([]);

    case 'PING': {
      if (args.length === 1) {
        return resp.simpleString('PONG');
      }
      if (args.length === 2) {
        return resp.bulkString(args[1]);
      }
      return resp.error("wrong number of arguments for 'ping' command");
    }

    case 'ECHO': {
      if (args.length !== 2) {
        return resp.error("wrong number of arguments for 'echo' command");
      }
      return resp.bulkString(args[1]);
    }

    case 'SET': {
      if (args.length < 3) {
        return resp.error("wrong number of arguments for 'set' command");
      }
      const key = args[1];
      const value = args[2];
      let ttlMs: number | undefined;

      for (let i = 3; i < args.length; i += 2) {
        const opt = args[i].toUpperCase();
        const rawVal = args[i + 1];
        if (!rawVal || (opt !== 'EX' && opt !== 'PX')) {
          return resp.error('syntax error');
        }
        const parsed = Number(rawVal);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          return resp.error('value is not an integer or out of range');
        }
        ttlMs = opt === 'EX' ? parsed * 1000 : parsed;
      }

      store.set(key, value, ttlMs);
      return resp.simpleString('OK');
    }

    case 'GET': {
      if (args.length !== 2) {
        return resp.error("wrong number of arguments for 'get' command");
      }
      return resp.bulkString(store.get(args[1]));
    }

    case 'EXPIRE': {
      if (args.length !== 3) {
        return resp.error("wrong number of arguments for 'expire' command");
      }
      const seconds = Number(args[2]);
      if (!Number.isInteger(seconds)) {
        return resp.error('value is not an integer or out of range');
      }
      return resp.integer(store.expire(args[1], seconds));
    }

    case 'TTL': {
      if (args.length !== 2) {
        return resp.error("wrong number of arguments for 'ttl' command");
      }
      return resp.integer(store.ttl(args[1]));
    }

    case 'DEL': {
      if (args.length < 2) {
        return resp.error("wrong number of arguments for 'del' command");
      }
      return resp.integer(store.del(args.slice(1)));
    }

    case 'SUBSCRIBE': {
      if (args.length < 2) {
        return resp.error("wrong number of arguments for 'subscribe' command");
      }
      return pubsub.subscribe(socket, args.slice(1));
    }

    case 'UNSUBSCRIBE': {
      return pubsub.unsubscribe(socket, args.slice(1));
    }

    case 'PUBLISH': {
      if (args.length !== 3) {
        return resp.error("wrong number of arguments for 'publish' command");
      }
      const count = pubsub.publish(args[1], args[2]);
      return resp.integer(count);
    }

    case 'QUIT': {
      socket.end(resp.simpleString('OK'));
      return '';
    }

    default:
      return resp.error(`unknown command '${args[0]}'`);
  }
}
