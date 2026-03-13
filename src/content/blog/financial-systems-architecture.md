---
title: The Irreversible Mistakes of Financial Systems Architecture
description: |
  Some architectural decisions are expensive to fix. Others you simply can't undo.
  Data modeling, concurrency, event sourcing — the calls you need to get right before scale makes them permanent.
publishDate: 2026-03-13 00:00:00
tags:
  - Architecture
  - MongoDB
  - CQRS
  - Trading Systems
  - Backend
---

In most software projects, bad decisions are expensive but fixable. In financial systems, some architectural decisions are permanent. You don't get to go back and replay history you forgot to record.

## The Join Problem: It Doesn't Matter Which Database You're Using

One of the most common mistakes engineers make when adopting MongoDB is importing their relational database thinking wholesale. The result: a document database being tortured with `$lookup` aggregations that would make a SQL DBA wince.

But here's the thing — **this isn't really a MongoDB problem. It's a data modeling problem that shows up everywhere.**

The same trap exists in relational databases. A PostgreSQL schema with 15 tables and a query that joins 8 of them on every page load has the same root cause: the data is stored in a shape that serves the writer, not the reader. It's normalized for correctness, not for performance. And at scale, correctness without performance means neither.

MongoDB's `$lookup` exists. It works. But it was never meant to be the primary way you query data at scale. When you have a collection of 100 billion documents and every read requires joining across collections, you have not escaped the join problem — you've just moved it somewhere that handles it worse. The same is true for a relational schema where every meaningful query requires a chain of joins across heavily normalized tables.

And to be clear: we hate joins. Even in SQL. A query joining 8 tables is already a red flag — it means nobody thought about how the data would be read. Relational databases can handle it better than MongoDB, but "handles it better" doesn't mean it's good.

If you're coming from a SQL codebase full of joins and moving to MongoDB, don't replicate that. You'd be taking a bad pattern and moving it somewhere that deals with it far worse. This is worth understanding, not just as a gotcha, but because it explains why the modeling discipline matters even more when you choose Mongo.

Relational databases were designed around joins. The query planner understands them, optimizes them, uses indexes across them, and can reorder operations to minimize I/O. A well-indexed join in PostgreSQL between two large tables is a solved problem that decades of engine development have made fast.

MongoDB was not designed around joins. `$lookup` is an aggregation pipeline stage that was added later, and it shows. A few specific reasons it's worse:

- **No cross-collection indexes.** In a relational DB, you can index foreign keys and the query planner will use them across joins. In MongoDB, `$lookup` cannot use indexes on the joined collection in most pipeline configurations — it does a collection scan on the foreign side for each document in the local side.
- **Sharding friction.** In a sharded cluster, `$lookup` requires cross-shard coordination that adds latency and overhead. While MongoDB has improved this over versions, joining across sharded collections still works against the horizontal scaling that was likely your reason for choosing MongoDB in the first place.
- **Memory limits.** Aggregation pipelines have a 100MB memory limit per stage by default. A `$lookup` that inflates documents can hit this quickly on large collections, forcing `allowDiskUse: true` and tanking performance further.
- **No query planner optimization.** PostgreSQL's planner chooses join strategies (hash join, nested loop, merge join) based on statistics. MongoDB's aggregation pipeline executes stages in the order you write them. You are the query planner. Get it wrong and there's no engine to save you.

| | Anti-Pattern | The Better Way |
|---|---|---|
| Data model | Normalized everywhere, joins on every read | Shape data around how it's read |
| MongoDB | `$lookup` on every query | Embed what you read together |
| PostgreSQL | 8-table join per request | Materialized views, denormalized read tables |
| Mindset | One schema for everything | Separate write shape from read shape |

The guiding principle is simple: **store what you need, where you need it.** If you always read a user's portfolio when you fetch their profile, that data should arrive in one fetch — whether that means embedding it in a MongoDB document, storing a denormalized row in a read table, or projecting it into a materialized view. A single read operation with everything already present costs one I/O. Joins always cost more.

The database engine changes. The problem doesn't.

### The sync event pattern

The objection to denormalization is always consistency — if the same data lives in multiple places, how do you keep it in sync?

The answer is event-driven synchronization. When the source data changes, publish a change event. Consumers update their denormalized copies asynchronously. You trade strong consistency for read performance, accepting eventual consistency where it's appropriate. For most read scenarios, it is.

## Reads vs Writes: The Tradeoff That Never Goes Away

Every database decision at scale is really the same decision expressed differently: do you pay at write time or read time?

- **Optimize for reads** — denormalize, embed, duplicate. Writes become expensive fan-outs, but reads are a single fetch.
- **Optimize for writes** — normalize, reference, single source of truth. Writes are cheap, reads pay the join cost.
- **Optimize for both** — this is what CQRS actually is.

Most applications are read-heavy. The classic 80/20 ratio — or often 90/10 — means defaulting toward read optimization is usually the right call. But trading systems flip this entirely.

> A trading platform with millions of orders per second cannot afford to pay read costs on the write path. Every millisecond of write latency is a competitive disadvantage and a potential source of financial error.

## CQRS: Stop Pretending One Model Can Serve Two Masters

Command Query Responsibility Segregation is a pattern that sounds academic until you've tried to serve high-frequency writes and complex reads from the same data model. Then it becomes obvious.

The write model is an append-only event log. Immutable, ordered, the source of truth. The read model is a projection — a pre-computed, denormalized view built specifically for how your UI needs to query data.

```
Client Command → Write Model (Events) → Event Stream
Event Stream → Projections → Read Model → Client Query
```

```javascript
// Write model — events, not state
{ type: "ORDER_PLACED", orderId, userId, price, qty, timestamp }
{ type: "ORDER_FILLED", orderId, fillPrice, qty, timestamp }
{ type: "ORDER_CANCELLED", orderId, timestamp }

// Read model — pre-computed, ready to display
{
  userId,
  positions: [{ symbol: "BTC", qty: 1.5, currentValue: 21000 }],
  totalValue: 42000,
  pnl: 1200
}
```

There is no reason the shape of your writes should match the shape of your reads. Traditional CRUD forces one model to serve both. CQRS acknowledges they're fundamentally different problems and treats them separately.

## Optimistic Locking: Handling Concurrent Writes Without Blocking

When multiple orders arrive simultaneously for the same user, you have a concurrency problem. The naive solution — pessimistic locking — blocks all concurrent reads while a write is in progress. At scale, this destroys throughput.

The better approach is optimistic locking with document versioning. Mongoose provides this out of the box:

```javascript
const placeOrder = async (userId, amount, retries = 3, delay = 100) => {
  if (retries === 0) throw new Error('Could not place order after max retries')

  const user = await User.findOne({ userId })

  if (!user) throw new Error('User not found')
  if (user.availableBalance < amount) throw new Error('Insufficient funds')

  const updated = await User.findOneAndUpdate(
    { userId, __v: user.__v },  // version check
    {
      $set: { availableBalance: user.availableBalance - amount },
      $inc: { __v: 1 }
    },
    { new: true }
  )

  if (updated) return updated

  // Version conflict — retry with backoff
  await new Promise(res => setTimeout(res, delay))
  return placeOrder(userId, amount, retries - 1, delay * 2)
}
```

The version number travels from read to write. If another write happened in between, the version no longer matches and the update finds nothing. The function retries, re-reading the latest state and attempting again with exponential backoff.

> **Mongoose note:** By default, `__v` only applies to array modifications. For full optimistic locking across all fields, enable `optimisticConcurrency: true` in your schema options.

## The Decisions You Cannot Undo

> "You can refactor code. You can rewrite services. But you cannot go back in time and capture events that were never recorded."

This is where trading systems diverge from ordinary software. When people say architectural decisions are hard to change, they usually mean expensive, slow, risky. In financial systems, some decisions are simply impossible to reverse.

- **Data is already in the wrong shape.** Migrating 100 billion documents to a new model while the system is live handling real transactions is not a refactor. It is a crisis.
- **Clients depend on current behavior.** Changing the write model breaks every downstream consumer simultaneously. In a distributed system, that's not a deployment — it's an incident.
- **No event history.** If you started with CRUD, you have current state. You have no idea how you got there. You cannot reconstruct what happened, you cannot replay. That history does not exist and cannot be created retroactively.
- **Regulatory requirements.** In most jurisdictions, financial systems are legally required to maintain complete audit trails. If yours doesn't have one, you're not just technically compromised — you may be non-compliant.

A CRUD architecture shows you current state. An event-sourced architecture shows you current state *and* the complete history of how you arrived there. Once you've been running CRUD in production, you cannot manufacture that history. It's gone.

### Why "move fast and break things" is dangerous here

The startup instinct to ship fast and refactor later works when the cost of being wrong is a slow sprint or a painful migration. It does not work when:

- Real money is at stake
- Regulatory audits are a reality
- The data you didn't capture cannot be recreated
- Your users trusted you with their financial assets

A missing feature can be added in the next release. A missing event log cannot be added at any point after the fact. The architecture you choose on day one determines what is possible on day one thousand.

## What Good Architecture Requires

The honest answer is that getting this right requires having already gotten it wrong somewhere. The engineers who push for event sourcing and CQRS on day one aren't being academic — they're preventing a category of mistake they have already made and paid for.

Before writing a line of business logic: decide on your consistency model, design your event schema, separate your read and write models, implement versioning, and build your retry and conflict resolution strategy. These are not premature optimizations. They are the foundation everything else stands on.

The read vs write tradeoff, MongoDB's document model, CQRS, event sourcing, optimistic locking — none of these are separate topics. They are all expressions of the same underlying question: *where does the complexity live, and can you afford to move it later?*

In financial systems, the answer is: you cannot. Decide carefully, upfront, and build something you can live with at scale. Because once you're at scale, you're living with whatever you built on day one.

## But Sometimes You Should Go Fast Anyway

None of this means you must implement full CQRS and event sourcing before you write your first endpoint. That would be its own mistake.

The real skill is knowing *when* the irreversibility applies. And that requires being pragmatic, not dogmatic.

If you're validating a product idea, building an MVP, or operating at a scale where none of these failure modes are remotely close — go fast. CRUD is fine. A single model is fine. Optimize for learning and shipping, not for a scale you don't have yet. YAGNI is a legitimate principle and it has saved teams from years of unnecessary complexity.

The tradeoff is explicit: you are choosing speed now and accepting that you may need to pay down the architectural debt later. That's a valid decision. The mistake is not making it consciously — shipping CRUD because it's the default, not because you evaluated the tradeoffs and decided it fit.

Where it gets dangerous is when the "go fast" decision is made without acknowledging what it costs:

- **At what scale does this break?** Know the number. If you're at 10k users and the model breaks at 10M, you have runway. If you're already at 5M, you don't.
- **What would a migration look like?** If you can describe the path from here to a more robust model, the debt is manageable. If the path doesn't exist — if you'd have to rewrite the entire data layer live in production — that's not debt, that's a trap.
- **Is the data irrecoverable?** Skipping event sourcing on a todo app is fine. Skipping it on a system where transactions represent real money and regulators will ask questions is a different category of decision.

Pragmatism means choosing the right level of complexity for the current context — not always the simplest thing, not always the most robust thing. The engineers who apply CQRS to a weekend project are over-engineering. The engineers who apply CRUD to a high-volume financial system and call it pragmatism are just moving the problem somewhere harder to fix.

Know what you're trading. Make the call deliberately. Then own it.
