import type { Socket } from 'node:net';
import { resp } from './resp.ts';

export class PubSub {
  private channels = new Map<string, Set<Socket>>();
  private clientChannels = new Map<Socket, Set<string>>();

  subscribe(socket: Socket, channelNames: string[]): string {
    let clientSet = this.clientChannels.get(socket);
    if (!clientSet) {
      clientSet = new Set<string>();
      this.clientChannels.set(socket, clientSet);
    }

    const frames: string[] = [];
    for (const channel of channelNames) {
      let subs = this.channels.get(channel);
      if (!subs) {
        subs = new Set<Socket>();
        this.channels.set(channel, subs);
      }
      subs.add(socket);
      clientSet.add(channel);

      frames.push(
        resp.array([
          resp.bulkString('subscribe'),
          resp.bulkString(channel),
          resp.integer(clientSet.size),
        ])
      );
    }

    return frames.join('');
  }

  unsubscribe(socket: Socket, channelNames: string[]): string {
    const clientSet = this.clientChannels.get(socket);
    const targets =
      channelNames.length > 0
        ? channelNames
        : clientSet
          ? Array.from(clientSet)
          : [];

    if (targets.length === 0) {
      return resp.array([
        resp.bulkString('unsubscribe'),
        resp.bulkString(null),
        resp.integer(0),
      ]);
    }

    const frames: string[] = [];
    for (const channel of targets) {
      this.channels.get(channel)?.delete(socket);
      if (this.channels.get(channel)?.size === 0) {
        this.channels.delete(channel);
      }
      clientSet?.delete(channel);
      const remaining = clientSet ? clientSet.size : 0;

      frames.push(
        resp.array([
          resp.bulkString('unsubscribe'),
          resp.bulkString(channel),
          resp.integer(remaining),
        ])
      );
    }

    if (clientSet && clientSet.size === 0) {
      this.clientChannels.delete(socket);
    }

    return frames.join('');
  }

  publish(channel: string, message: string): number {
    const subs = this.channels.get(channel);
    if (!subs || subs.size === 0) {
      return 0;
    }

    const payload = resp.array([
      resp.bulkString('message'),
      resp.bulkString(channel),
      resp.bulkString(message),
    ]);

    let delivered = 0;
    for (const subscriber of subs) {
      if (!subscriber.destroyed) {
        subscriber.write(payload);
        delivered++;
      }
    }
    return delivered;
  }

  cleanup(socket: Socket): void {
    const clientSet = this.clientChannels.get(socket);
    if (!clientSet) {
      return;
    }
    for (const channel of clientSet) {
      const subs = this.channels.get(channel);
      if (subs) {
        subs.delete(socket);
        if (subs.size === 0) {
          this.channels.delete(channel);
        }
      }
    }
    this.clientChannels.delete(socket);
  }
}
