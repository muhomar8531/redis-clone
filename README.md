# Mini Redis Clone in TypeScript

A lightweight TCP server speaking the **RESP2** protocol, built with Node's native TypeScript runner and `node:net`.

## Supported Commands

- **Connection / Diagnostics**: `PING [msg]`, `ECHO <msg>`, `COMMAND`, `QUIT`
- **Key-Value & Expiration**:
  - `SET <key> <value> [EX <seconds> | PX <milliseconds>]`
  - `GET <key>`
  - `EXPIRE <key> <seconds>`
  - `TTL <key>`
  - `DEL <key> [key ...]`
- **Pub/Sub**:
  - `SUBSCRIBE <channel> [channel ...]`
  - `UNSUBSCRIBE [channel ...]`
  - `PUBLISH <channel> <message>`

## Quick Start

```bash
# Start the server (listens on 127.0.0.1:6379 by default)
npm start

# Run automated TCP integration tests
npm test
```

## Testing with `redis-cli`

```bash
redis-cli PING
redis-cli SET mykey "hello"
redis-cli GET mykey
redis-cli EXPIRE mykey 5
redis-cli TTL mykey
```
