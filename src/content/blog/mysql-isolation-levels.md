---
title: MySQL Isolation Levels and the Problems They Solve
description: |
  Dirty reads, non-repeatable reads, phantom reads — each one is a real bug
  waiting to happen. Here's what they are, when they occur, and which isolation
  level fixes each one.
publishDate: 2026-03-14 00:00:00
tags:
  - Database
  - MySQL
  - Backend
  - Architecture
---

## Concurrent Transactions Are Complicated

Most of the time you think about a database query as a single, isolated operation. You send a `SELECT`, you get rows back, done. But in any real application, dozens of transactions are running simultaneously — reads and writes interleaved, each one seeing a different slice of the database at a different point in time.

That's where anomalies happen. And the SQL standard defines a hierarchy of isolation levels specifically to control which anomalies you're willing to tolerate in exchange for performance.

MySQL (InnoDB) supports all four standard levels. Understanding them means understanding the three problems they're designed to prevent.

## The Three Anomalies

### Dirty Read

A dirty read happens when a transaction reads data that another transaction has written but not yet committed.

```sql
-- Transaction A
START TRANSACTION;
UPDATE accounts SET balance = balance - 500 WHERE id = 1;
-- A has not committed yet

-- Transaction B (running concurrently)
START TRANSACTION;
SELECT balance FROM accounts WHERE id = 1;
-- B reads the deducted balance — but A might roll back
-- B is now working with data that may never have existed
```

This is the worst anomaly. If Transaction A rolls back, Transaction B has made decisions based on data that was never real. In a financial system this can mean crediting an account for a transfer that was never finalised.

### Non-Repeatable Read

A non-repeatable read happens when a transaction reads the same row twice and gets different values, because another transaction modified and committed that row in between.

```sql
-- Transaction A
START TRANSACTION;
SELECT balance FROM accounts WHERE id = 1;
-- returns 1000

-- Transaction B commits a withdrawal
UPDATE accounts SET balance = 600 WHERE id = 1;
COMMIT;

-- Transaction A reads again
SELECT balance FROM accounts WHERE id = 1;
-- returns 600 — same query, different result
COMMIT;
```

Transaction A is seeing a moving target. If it's computing something — say, checking that a balance is sufficient before proceeding — the data it checked may no longer be true by the time it acts on it.

### Phantom Read

A phantom read is like a non-repeatable read, but for rows rather than values. A transaction runs the same query twice and gets a different *set* of rows, because another transaction inserted or deleted rows that match the query's filter.

```sql
-- Transaction A
START TRANSACTION;
SELECT COUNT(*) FROM orders WHERE user_id = 42 AND status = 'pending';
-- returns 3

-- Transaction B inserts a new order and commits
INSERT INTO orders (user_id, status) VALUES (42, 'pending');
COMMIT;

-- Transaction A counts again
SELECT COUNT(*) FROM orders WHERE user_id = 42 AND status = 'pending';
-- returns 4 — a phantom row appeared
COMMIT;
```

The difference from non-repeatable reads: the existing rows haven't changed, but new ones have appeared (or disappeared). This can break logic that assumes the dataset is stable for the duration of the transaction.

## The Four Isolation Levels

The SQL standard defines four isolation levels, each one stricter than the last — and each one more expensive in terms of concurrency.

| Level | Dirty Read | Non-Repeatable Read | Phantom Read |
|---|---|---|---|
| READ UNCOMMITTED | Possible | Possible | Possible |
| READ COMMITTED | Prevented | Possible | Possible |
| REPEATABLE READ | Prevented | Prevented | Possible* |
| SERIALIZABLE | Prevented | Prevented | Prevented |

*MySQL's REPEATABLE READ actually prevents phantoms too in most cases, via gap locks. More on that below.

### READ UNCOMMITTED

The lowest level. Transactions can read each other's uncommitted changes. Dirty reads are possible. There's almost no reason to use this in practice — the performance gains are minimal and the correctness risks are severe.

```sql
SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
```

Use case: essentially none in application code. Sometimes used for rough analytics queries on append-only tables where you truly don't care about in-flight writes.

### READ COMMITTED

Each read within a transaction sees only committed data. Dirty reads are impossible — if Transaction B hasn't committed, Transaction A can't see its changes. But the snapshot is taken fresh on *each statement*, so if another transaction commits between two reads, you'll see the updated data.

```sql
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

This is the default in PostgreSQL and Oracle. It's a good default for many OLTP applications: no dirty reads, reasonable concurrency, and predictable behaviour for most queries.

The trade-off: non-repeatable reads are still possible. A row you read at the start of your transaction may look different if you read it again later, because someone else committed a change in between.

### REPEATABLE READ

MySQL's default. Once a transaction starts, it gets a consistent snapshot of the database as it was at that moment. Every read within the transaction — no matter how many times you read the same row — returns the same data.

```sql
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
-- This is the default; you don't need to set it explicitly
```

MySQL implements this with MVCC (Multi-Version Concurrency Control). Instead of locking rows on every read, InnoDB keeps multiple versions of each row and serves each transaction from the version that was current when the transaction started. Reads don't block writes, and writes don't block reads.

```sql
-- Transaction A starts
START TRANSACTION;
SELECT balance FROM accounts WHERE id = 1; -- sees 1000

-- Transaction B updates and commits
UPDATE accounts SET balance = 600 WHERE id = 1;
COMMIT;

-- Transaction A reads again
SELECT balance FROM accounts WHERE id = 1;
-- still sees 1000 — the snapshot from when A started
COMMIT;
```

Non-repeatable reads are impossible here. The snapshot is stable.

**Gap locks and phantom prevention**: MySQL's REPEATABLE READ goes further than the SQL standard requires. For range queries, InnoDB uses gap locks — locks on the *space between* indexed values — to prevent other transactions from inserting rows that would fall into a range you've already scanned.

```sql
-- Transaction A
START TRANSACTION;
SELECT * FROM orders WHERE amount BETWEEN 100 AND 500 FOR UPDATE;
-- InnoDB acquires gap locks on the range 100–500

-- Transaction B tries to insert
INSERT INTO orders (amount) VALUES (250);
-- Blocked until Transaction A commits or rolls back
```

This means phantom reads are prevented in practice for most queries, even though the standard only guarantees this at SERIALIZABLE.

### SERIALIZABLE

The strictest level. Every transaction behaves as if it ran one after another, not concurrently. InnoDB achieves this by converting all plain `SELECT` statements into `SELECT ... FOR SHARE` — locking every row it reads so no other transaction can modify them.

```sql
SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE;
```

This eliminates all three anomalies completely. It also eliminates most of your concurrency. Transactions block each other far more often, deadlocks become more likely, and throughput drops significantly under contention.

Use SERIALIZABLE when the correctness requirement is absolute — financial reconciliation, inventory with hard limits, any operation where you cannot tolerate the data changing under you even in theory.

## Selecting Rows for Update

One more tool that matters regardless of isolation level: `SELECT ... FOR UPDATE`.

```sql
START TRANSACTION;

SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;
-- Now no other transaction can modify or lock this row

UPDATE accounts SET balance = balance - 200 WHERE id = 1;
COMMIT;
```

`FOR UPDATE` acquires an exclusive lock immediately on read, not on write. This closes a common race condition at REPEATABLE READ: two transactions each reading the same row, both seeing sufficient balance, both proceeding to deduct — the classic double-spend.

Without it:

```sql
-- Both transactions run concurrently
-- Both read balance = 500
-- Both check: 500 >= 300? yes
-- Both deduct 300
-- Final balance: -100
```

With `FOR UPDATE`, the second transaction blocks until the first commits, then reads the updated value and may correctly decide not to proceed.

`SELECT ... FOR SHARE` is the read equivalent — it allows other transactions to read the same row but blocks any writes.

## What to Actually Use

**READ COMMITTED** is a solid default if you're used to PostgreSQL or if your application logic doesn't rely on stable reads within a transaction. It avoids dirty reads, has good concurrency, and is explicit about what you get.

**REPEATABLE READ** (MySQL's default) is the right choice for most OLTP work. MVCC means reads are essentially free from a locking perspective, the snapshot guarantee makes application logic easier to reason about, and gap locks handle most phantom scenarios without requiring SERIALIZABLE.

**SERIALIZABLE** when correctness is non-negotiable and you can afford the concurrency cost. Usually this means a small number of critical operations, not the entire application.

**READ UNCOMMITTED** almost never.

And regardless of isolation level: use `SELECT ... FOR UPDATE` any time you read a row with the intent to modify it based on its current value. The snapshot is great, but it doesn't protect you from another transaction that committed after your snapshot was taken and before your write landed.

The isolation level defines what MySQL will do automatically. `FOR UPDATE` is what you do explicitly when you know you need it.
