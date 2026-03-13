---
title: Offset Pagination Will Kill Your Database
description: |
  LIMIT and OFFSET look innocent. At scale they become one of the most expensive
  queries you can run. Here's why, and what to use instead.
publishDate: 2026-03-13 00:00:00
tags:
  - Backend
  - Database
  - PostgreSQL
  - MongoDB
  - Performance
---

## The Default Choice

When you need to paginate a list, the first instinct is `LIMIT` and `OFFSET`. It maps directly to how you think about pages: give me 20 results, starting at position 40.

```sql
SELECT * FROM orders
ORDER BY created_at DESC
LIMIT 20 OFFSET 40;
```

Simple. Readable. Works in every database. Works fine in development, works fine in staging, works fine in production — until the table grows.

## What OFFSET Actually Does

This is the part that surprises people: **the database doesn't skip to row 40 and start reading from there.** It reads all rows from the beginning, counts 40 of them, discards them, and returns the next 20.

Every time you request page N, the database scans and discards all rows before it. Page 1 discards 0 rows. Page 100 discards 1,980 rows. Page 1000 discards 19,980 rows. The further into the dataset you go, the more work the database does — and almost all of that work is thrown away.

At a million rows and deep pagination, a single query can become a full table scan. And if multiple users are paginating simultaneously, you're running that expensive scan in parallel for each of them.

```sql
-- This looks harmless
SELECT * FROM orders ORDER BY created_at DESC LIMIT 20 OFFSET 980000;

-- What the database actually does:
-- 1. Scan the entire orders table
-- 2. Sort by created_at (or use an index, still needs to traverse it)
-- 3. Count through 980,000 rows
-- 4. Discard them
-- 5. Return 20 rows
-- Total work: 980,020 rows touched for 20 returned
```

Even with an index on `created_at`, the database still has to traverse 980,000 index entries before it gets to the ones you want.

## Cursor Pagination

The alternative is to paginate by position in the data, not by count. Instead of "skip N rows," you say "give me rows after this specific value."

```sql
-- First page — no cursor needed
SELECT * FROM orders
ORDER BY created_at DESC, id DESC
LIMIT 20;

-- Next page — use the last row from the previous result as the cursor
SELECT * FROM orders
WHERE (created_at, id) < ('2024-01-15T10:00:00Z', 'order_980')
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

The database doesn't scan and discard. It uses the index to jump directly to the cursor position and reads forward from there. Page 1000 costs exactly the same as page 1. The query time is constant regardless of how deep into the dataset you are.

In an API, this looks like returning an opaque cursor with each page:

```typescript
interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
}

async function getOrders(cursor?: string): Promise<PaginatedResult<Order>> {
  const decodedCursor = cursor ? decodeCursor(cursor) : null;

  const orders = await db.orders.findMany({
    where: decodedCursor
      ? {
          OR: [
            { createdAt: { lt: decodedCursor.createdAt } },
            { createdAt: decodedCursor.createdAt, id: { lt: decodedCursor.id } },
          ],
        }
      : undefined,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 21, // fetch one extra to know if there's a next page
  });

  const hasMore = orders.length === 21;
  const data = hasMore ? orders.slice(0, 20) : orders;
  const lastItem = data[data.length - 1];

  return {
    data,
    nextCursor: hasMore
      ? encodeCursor({ createdAt: lastItem.createdAt, id: lastItem.id })
      : null,
  };
}
```

The cursor encodes the position in the dataset. The client passes it back to get the next page. The server never needs to count how many rows came before it.

## The Composite Cursor Problem

One thing to get right: **cursor pagination requires a unique, stable sort key.** If you sort by `created_at` alone and two rows have the same timestamp, the cursor is ambiguous — you don't know which one to start after, and you'll either miss rows or return duplicates.

The fix is to include a tiebreaker in the cursor — typically the primary key, which is always unique:

```sql
ORDER BY created_at DESC, id DESC
```

And the cursor condition needs to match:

```sql
WHERE (created_at < $cursor_date)
   OR (created_at = $cursor_date AND id < $cursor_id)
```

This ensures the cursor always points to a unique position, even when timestamps collide.

## When Offset Pagination Is Fine

Cursor pagination has one real limitation: **you can't jump to an arbitrary page.** You can only go forward (or backward with a prev cursor). There's no "go to page 47."

For most product use cases, that's fine — infinite scroll, "load more" buttons, and API consumers walking through results sequentially don't need random page access.

But for admin interfaces, search results with numbered pages, or reports where users need to jump to a specific page — offset pagination is still the pragmatic choice. Just know the tradeoff: at small dataset sizes it doesn't matter, but as the table grows, deep page access gets progressively more expensive.

| | Offset | Cursor |
|---|---|---|
| Random page access | Yes | No |
| Consistent performance at scale | No | Yes |
| Simple to implement | Yes | More work |
| Handles real-time data insertion | Poorly (rows shift) | Yes |
| Works with any sort order | Yes | Requires unique sort key |

One more problem with offset in real-time data: if rows are inserted while a user is paginating, the offsets shift. A user on page 3 might see a row they already saw on page 2, or skip a row entirely. Cursor pagination is immune to this — the cursor points to a position, not a count.

## The Rule of Thumb

If the table will stay small (tens of thousands of rows, rarely paginated deeply), offset is fine. Ship it, move on.

If the table grows unboundedly — orders, events, logs, user activity — start with cursor pagination. The cost of adding it later is a migration and a breaking API change. The cost of adding it upfront is an afternoon.

`LIMIT` and `OFFSET` look innocent. At scale, they're one of the most quietly expensive patterns in a backend. Know what they cost before you commit to them.
