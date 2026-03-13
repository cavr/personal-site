---
title: You Probably Don't Need WebSockets
description: |
  WebSockets are the first thing people reach for when they need real-time updates.
  They're also usually overkill. SSE and polling exist, they're simpler, and they're often the better call.
publishDate: 2026-03-13 00:00:00
tags:
  - Backend
  - Architecture
  - Node.js
  - Real-time
---

## The Reflex

Someone asks for live order status updates. Or a notification badge. Or a dashboard that refreshes automatically. And before the conversation is over, someone has proposed WebSockets.

It makes sense on the surface. WebSockets are real-time. Real-time is what we need. Done.

Except WebSockets come with real costs — a persistent bidirectional connection per client, stateful infrastructure, load balancer configuration, reconnection logic, and operational complexity that compounds at scale. And most of the time, none of that is actually needed.

Before reaching for WebSockets, it's worth asking: does the communication actually need to go both ways?

## Three Tools, Three Use Cases

### Polling

The client asks the server for updates on a timer. That's it.

```typescript
function pollOrderStatus(orderId: string) {
  setInterval(async () => {
    const res = await fetch(`/api/orders/${orderId}/status`);
    const { status } = await res.json();
    updateUI(status);
  }, 3000);
}
```

Dumb, simple, works everywhere. No special infrastructure. No persistent connections. Scales horizontally without any changes. Your existing REST API, your existing load balancer, nothing changes.

The downsides are real: you're making requests even when nothing has changed, and there's always a delay up to the interval length. But for a lot of use cases — a status page that refreshes every 30 seconds, a dashboard that updates every minute — this is completely fine and the right choice.

### Server-Sent Events (SSE)

The client opens one HTTP connection and the server streams updates down it whenever there's something new. One direction only: server to client.

```typescript
// Server (Node.js / Express)
app.get('/api/orders/:id/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send update when order changes
  const unsubscribe = orderEvents.on(`order:${req.params.id}`, send);

  req.on('close', () => {
    unsubscribe();
  });
});
```

```typescript
// Client
const source = new EventSource('/api/orders/123/stream');

source.onmessage = (event) => {
  const update = JSON.parse(event.data);
  updateUI(update);
};
```

The browser handles reconnection automatically. It's built into the `EventSource` API — if the connection drops, the browser reconnects, and the server can resume from where it left off using the `Last-Event-ID` header.

SSE runs over plain HTTP. No protocol upgrade, no special load balancer config. Works with HTTP/2 out of the box, where you can have multiple SSE streams over a single connection.

### WebSockets

A persistent, full-duplex connection. Both sides can send messages at any time.

```typescript
// Only justified when the client genuinely needs to send messages too
const ws = new WebSocket('wss://api.example.com/ws');

ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  updateUI(update);
};

// Client sends messages back
ws.send(JSON.stringify({ type: 'ping' }));
```

WebSockets are the right tool when you have genuinely bidirectional, low-latency communication: multiplayer games, collaborative editing, live trading order entry, chat. When the client is sending messages to the server as frequently as the server is sending to the client.

## The Mismatch

The mistake isn't using WebSockets when they're appropriate. It's using them for scenarios that are fundamentally one-directional.

Live order tracking? The server sends updates, the client receives them. One direction.

Notification feed? Server pushes, client displays. One direction.

Dashboard metrics? Server streams data, client renders. One direction.

None of these need a bidirectional channel. Reaching for WebSockets anyway means taking on the full complexity of managing persistent connections for a problem that didn't require it.

## SSE and Load Balancers: The Buffering Problem

SSE looks simple until you put a load balancer in front of it. Then a class of subtle, hard-to-debug problems shows up that don't exist in local development.

### Response buffering

The most common issue: the load balancer or a proxy in the chain buffers the response, waiting to accumulate a full response before forwarding it to the client. For a normal HTTP response, this is a reasonable optimization. For SSE, it completely breaks the stream — the client sits there receiving nothing until the buffer flushes, which may never happen.

The fix is to explicitly tell every layer in the chain not to buffer:

```typescript
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
res.setHeader('X-Accel-Buffering', 'no'); // tells nginx not to buffer
```

`X-Accel-Buffering: no` is an nginx-specific header. If you're behind an nginx proxy or an nginx-based load balancer (common on AWS, GCP, and most PaaS platforms), this header disables response buffering for that response. Without it, nginx may silently buffer your SSE stream and the client sees nothing in real time.

If you control the nginx config directly:

```nginx
location /api/stream {
  proxy_pass http://backend;
  proxy_buffering off;
  proxy_cache off;
  proxy_read_timeout 86400s; # keep connection alive for long-lived streams
}
```

### Idle connection timeouts

Load balancers close connections that appear idle. An SSE stream where the server hasn't sent anything for 30–60 seconds looks idle to a load balancer — even though the connection is intentionally being kept open.

The fix is a heartbeat: send a comment line periodically to keep the connection alive.

```typescript
// Send a heartbeat comment every 20 seconds
const heartbeat = setInterval(() => {
  res.write(': heartbeat\n\n');
}, 20_000);

req.on('close', () => {
  clearInterval(heartbeat);
});
```

SSE comment lines start with `:` and are ignored by the browser's `EventSource`. They're purely for keeping the TCP connection alive through load balancers and proxies that would otherwise time it out.

The timeout threshold varies by provider — AWS ALB defaults to 60 seconds, nginx defaults to 60 seconds, Cloudflare to 100 seconds. Sending a heartbeat every 20–30 seconds covers most configurations.

### Sticky sessions (again, but worse for SSE)

With WebSockets, the need for sticky sessions is obvious and usually gets configured upfront. With SSE, engineers often forget — because it's just HTTP — and deploy without it.

But an SSE stream is still a long-lived connection tied to one server instance. If your server pushes events from in-memory state or a local event emitter, and a client's requests get routed to a different instance, they'll miss events. Or worse, the connection drops and reconnects to a different server that has no idea what the client was subscribed to.

Solutions, in order of increasing complexity:

- **Sticky sessions** on the load balancer — simplest, but loses connections if that instance goes down
- **Redis pub/sub** — each server instance publishes events to Redis, all instances subscribe and forward to their connected clients
- **A dedicated event bus** (Kafka, RabbitMQ) — for higher scale, same idea as Redis pub/sub but more durable

For most applications Redis pub/sub is the sweet spot:

```typescript
// On publish (any server instance)
redis.publish(`order:${orderId}`, JSON.stringify(update));

// On subscribe (each server instance, for each SSE connection)
const sub = redis.duplicate();
await sub.subscribe(`order:${orderId}`);
sub.on('message', (_, message) => {
  res.write(`data: ${message}\n\n`);
});

req.on('close', () => {
  sub.unsubscribe();
  sub.quit();
});
```

### The Cloud Run buffering problem — and the surprising fix

Here's a real one that catches people off guard, especially when streaming LLM responses or any kind of chunked output.

You build SSE locally. Works perfectly — chunks arrive as they're written, smooth and immediate. You deploy to Cloud Run. Suddenly the entire response arrives at once, at the end, as one big chunk. No streaming. Just a long wait and then everything at once.

The obvious culprit is Cloud Run's infrastructure: Google puts a Layer 7 load balancer in front of Cloud Run instances, and it can buffer responses. People spend hours adding headers, tweaking nginx config, trying `X-Accel-Buffering: no` — and none of it fixes it.

The less obvious culprit: **region latency**.

This is what actually happened to a team that ran into this exact issue. They'd initially deployed to `us-central1` while based in the US during prototyping. Later they were back in London, but the deployment still pointed at the US region. The round-trip latency between their client and the Cloud Run instance in the US was high enough that the infrastructure's buffers were filling up before anything flushed — so instead of streaming chunks, the load balancer accumulated them and delivered everything at the end.

Switching to `europe-west2` fixed it entirely. Same code, same headers, same configuration. Just a closer region.

The lesson: **buffering behavior is not purely a configuration problem — it's also a network problem.** When there's enough latency between the client and the server, intermediate infrastructure has time to accumulate chunks into a buffer. What looks like a streaming failure is actually a symptom of the response arriving faster at the buffer than the buffer is flushing downstream.

Things to check when SSE isn't streaming on Cloud Run or similar managed platforms:

- **Deploy to the region closest to your users.** This is the first thing to try and the most commonly overlooked.
- Set `X-Accel-Buffering: no` on the response — it doesn't hurt and helps with nginx-based infrastructure.
- Set `Transfer-Encoding: chunked` explicitly if your framework doesn't do it automatically.
- If you're going through multiple layers (Cloud Endpoints, API Gateway, a reverse proxy) — each one is a potential buffer. Test with a direct connection to the backend to isolate where the buffering is happening.
- Cloud Run has a minimum response size before it starts flushing. Sending a padding comment at the start of the stream (`': padding\n\n'` repeated a few times) can help trigger the initial flush.

Managed serverless platforms are convenient, but they trade infrastructure control for simplicity. When that infrastructure gets in the way of streaming, the answer isn't always more configuration — sometimes it's just geography.

### HTTP/2 and SSE

One underrated benefit of SSE on HTTP/2: multiple SSE streams from the same client share a single TCP connection via multiplexing. With HTTP/1.1, browsers limit concurrent connections per domain (usually 6), so a page with multiple SSE streams can exhaust that limit quickly. HTTP/2 eliminates that problem.

The catch: make sure your load balancer supports HTTP/2 end-to-end, including between the load balancer and your backend servers. Many setups terminate HTTP/2 at the load balancer and use HTTP/1.1 to the backend, which is fine for normal requests but worth knowing about.

## What That Complexity Actually Looks Like

**Load balancers need sticky sessions or a shared pub/sub layer.** A WebSocket connection is tied to one server instance. If you have three servers and a client connects to server A, all subsequent messages for that client need to reach server A — or you need a Redis pub/sub layer so any server can forward messages to the right connection. SSE has the same issue, but polling doesn't — each request can hit any server.

**Reconnection logic is your problem.** The browser handles SSE reconnection automatically. With WebSockets, you're writing that yourself: exponential backoff, connection state management, message queuing while disconnected.

**Proxies and firewalls.** SSE is plain HTTP. WebSockets require an upgrade handshake that some corporate proxies and older infrastructure silently drops. You won't find this out until a client in the field can't connect.

**Horizontal scaling is more work.** Stateless HTTP servers are easy to scale — spin up more, put a load balancer in front. Stateful WebSocket servers require more coordination. Not unsolvable, but more infrastructure to run and reason about.

## How to Actually Choose

Start with the simplest thing that works.

**Use polling when:**
- Updates don't need to be immediate (seconds of delay is acceptable)
- You want zero infrastructure changes
- The data source is a plain REST endpoint you already have
- Traffic is low and the extra requests don't matter

**Use SSE when:**
- Updates need to feel real-time but the client never sends messages back
- You want efficient server push without polling overhead
- You're already on HTTP/2
- You want automatic reconnection for free

**Use WebSockets when:**
- The client genuinely sends messages to the server at high frequency
- Latency requirements are extreme (sub-100ms, gaming, live trading)
- You have true bidirectional communication, not just server-to-client push with occasional client messages

Most "real-time" product requirements are actually just server-to-client push. SSE covers that completely. Polling covers it acceptably in many cases. WebSockets are for the genuinely bidirectional case, which is rarer than the initial instinct suggests.

The complexity you take on should match the problem you actually have. Not the problem that sounds more interesting to solve.
