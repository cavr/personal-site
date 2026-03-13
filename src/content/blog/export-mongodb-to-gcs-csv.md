---
title: Streaming MongoDB Data to GCS as CSV — Stop Loading It All Into Memory
description: |
  A very common backend task that kills services with OOM errors. Here's the real
  way to export large MongoDB collections to Google Cloud Storage without blowing up your process.
publishDate: 2026-03-13 00:00:00
tags:
  - Node.js
  - MongoDB
  - Google Cloud
  - TypeScript
  - Streams
---

## The Use Case

Exporting data from a database to a file is one of the most routine backend tasks you'll ever write. Product needs a CSV dump of all users for the data team. Finance wants a report of every transaction from the last quarter. A client asks for a full export of their records.

The examples below use MongoDB and Google Cloud Storage, but **the pattern applies universally** — PostgreSQL, MySQL, DynamoDB, any cursor-based data source pairs the same way with S3, Azure Blob Storage, a local filesystem, or any writable stream. The storage and database are interchangeable; the streaming shape is what matters.

In MongoDB, this usually means hitting a collection, iterating documents, and writing them out to some destination — in this case a CSV file in Google Cloud Storage. Simple enough on the surface.

But then your collection has 2 million documents. Or 10 million. And suddenly the service that was working fine in staging crashes in production with a cryptic `JavaScript heap out of memory` error, a timed-out HTTP response, or a dropped connection with no clear cause.

This is one of the most common and avoidable mistakes in backend development.

## The Classic Mistake: Read Everything First

The first instinct is to use `find().toArray()`. It's simple, it works in tests, and the docs even show it in examples:

```typescript
// This will kill your process on large collections
const docs = await collection.find({}).toArray();
const csv = docs.map(doc => `${doc.id},${doc.name},${doc.email}`).join('\n');
await bucket.file('export.csv').save(csv);
```

This pattern has a fundamental flaw: **everything lives in memory at the same time**.

- `toArray()` fetches every document from MongoDB and holds the entire result set in a JavaScript array.
- The string concatenation or CSV serialization creates another full copy of that data in memory.
- The upload buffers that string again before sending it to GCS.

At small scale this is invisible. At 100k documents it starts to feel slow. At 1M+ documents:

- Node.js hits the V8 heap limit (default ~1.5 GB) and throws `FATAL ERROR: Reached heap limit Allocation failed`.
- If you increase the heap limit with `--max-old-space-size`, you're just delaying the crash and burning more RAM on a pod that could be running other workloads.
- Even if it doesn't crash, holding millions of records in memory while serializing and uploading makes your service unresponsive to other requests.

The error usually looks something like this in your logs:

```
FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory
 1: 0xb7c6e0 node::Abort() [node]
 2: 0xa9149d node::FatalError(char const*, char const*) [node]
...
Aborted (core dumped)
```

And the worst part: it only happens in production, on the large dataset, at 2am when no one is watching.

## The Mental Model Shift: Process, Don't Accumulate

The solution is to stop thinking about the export as "collect then write" and start thinking about it as a pipeline: data flows through your process one chunk at a time, never fully materializing in memory.

MongoDB cursors already support this. A cursor is lazy — it fetches documents in batches from the server, gives you one at a time, and fetches the next batch only when you ask. The mistake is calling `.toArray()`, which forces the cursor to drain everything immediately.

Instead, keep the cursor lazy. Stream documents from Mongo into a CSV formatter, stream the formatted rows into GCS. At any given moment you only hold one batch of documents in memory, not the whole collection.

## Version 1: Direct Cursor Stream

The first streaming version pipes MongoDB's cursor stream directly into `fast-csv` and then into GCS:

```typescript
import { MongoClient } from "mongodb";
import { Storage } from "@google-cloud/storage";
import { format } from "@fast-csv/format";
import { pipeline } from "stream/promises";

interface ExportConfig {
  mongoUri: string;
  database: string;
  collectionName: string;
  bucketName: string;
  fileName: string;
  columns?: string[];
  batchSize?: number;
}

class ExportMongoToGCSUseCase {
  private readonly config: ExportConfig;
  private mongoClient: MongoClient;
  private storage: Storage;

  constructor(config: ExportConfig) {
    this.config = config;
    this.mongoClient = new MongoClient(config.mongoUri);
    this.storage = new Storage();
  }

  async execute(): Promise<void> {
    try {
      await this.mongoClient.connect();

      const collection = this.mongoClient
        .db(this.config.database)
        .collection(this.config.collectionName);

      const cursor = collection
        .find({})
        .batchSize(this.config.batchSize ?? 1000);

      const file = this.storage
        .bucket(this.config.bucketName)
        .file(this.config.fileName);

      await pipeline(
        cursor.stream(),
        format({ headers: this.config.columns ?? true }),
        file.createWriteWrite({
          resumable: true,
          contentType: "text/csv",
        })
      );
    } finally {
      await this.mongoClient.close();
    }
  }
}
```

Memory usage is now bounded by `batchSize`, not collection size. This works — but it has a problem: raw MongoDB documents go straight to the CSV formatter. You get `_id` as a serialized ObjectId object, raw `Date` objects that stringify as `"2024-01-15T00:00:00.000Z"` only if you're lucky, nested objects that collapse into `[object Object]`, and any internal Mongo fields you never wanted in the export.

## Version 2: Async Generator for Clean Field Mapping

The improved version wraps the cursor in an async generator so you control exactly what each CSV row looks like:

```typescript
import { MongoClient } from "mongodb";
import { Storage } from "@google-cloud/storage";
import { format } from "@fast-csv/format";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

class ExportMongoToGCSUseCase {
  private readonly config: ExportConfig;
  private mongoClient: MongoClient;
  private storage: Storage;

  constructor(config: ExportConfig) {
    this.config = config;
    this.mongoClient = new MongoClient(config.mongoUri);
    this.storage = new Storage();
  }

  async execute(): Promise<void> {
    try {
      await this.mongoClient.connect();

      const collection = this.mongoClient
        .db(this.config.database)
        .collection(this.config.collectionName);

      const cursor = collection
        .find({})
        .batchSize(this.config.batchSize ?? 1000);

      const file = this.storage
        .bucket(this.config.bucketName)
        .file(this.config.fileName);

      await pipeline(
        Readable.from(this.streamDocs(cursor)),
        format({ headers: this.config.columns ?? true }),
        file.createWriteStream({
          resumable: true,
          contentType: "text/csv",
        })
      );
    } finally {
      await this.mongoClient.close();
    }
  }

  private async *streamDocs(cursor: any) {
    for await (const doc of cursor) {
      yield {
        id: doc._id.toString(),
        name: doc.name,
        email: doc.email,
        createdAt: doc.createdAt?.toISOString() ?? "",
        status: doc.active ? "Active" : "Inactive",
      };
    }
  }
}
```

`Readable.from(this.streamDocs(cursor))` converts the async generator into a proper Node.js readable stream. The generator pulls one document at a time from the cursor, transforms it into a clean plain object, and yields it. `Readable.from` handles backpressure — if GCS is slow to accept data, it pauses the generator, which pauses the cursor, which pauses fetching from Mongo. The whole pipeline breathes together.

## Why Each Piece Matters

**`batchSize` on the cursor** — MongoDB pulls documents in batches from the server. Without an explicit batchSize, MongoDB defaults to 101 documents for the first batch and up to 16MB for subsequent ones. Setting it explicitly (1000 is a good default) gives you predictable memory behavior.

**`pipeline` from `stream/promises`** — The promisified version properly propagates errors through the chain and cleans up all streams on failure. If you use `.pipe()` directly and the CSV formatter throws, the GCS write stream may stay open indefinitely. `pipeline` handles teardown for you.

**`resumable: true` on GCS** — For anything more than a few MB, use resumable uploads. GCS breaks the upload into chunks and can recover from transient network failures without restarting from byte zero. Without this, a network hiccup at 95% completion means starting over.

**`finally` for client cleanup** — The MongoDB client must be closed even if the pipeline throws. The `finally` block guarantees this regardless of success or failure.

## The Memory Profile Difference

To put it concretely: exporting a collection with 5 million documents where each document is ~500 bytes:

| Approach | Peak Memory |
|---|---|
| `toArray()` + string join | ~3–5 GB (often crashes) |
| Streaming pipeline | ~20–50 MB |

The streaming version's memory usage stays flat whether you're exporting 10k or 10M documents. That's the point.

## Swapping the Database or Storage Backend

The streaming shape is the same regardless of what sits at each end of the pipeline. The async generator is the transformation layer — everything above it is just a source, everything below it is just a sink.

**Different databases, same shape:**

PostgreSQL with `pg` has a query streaming API:
```typescript
import { Client } from "pg";
import QueryStream from "pg-query-stream";

const client = new Client({ connectionString });
await client.connect();
const stream = client.query(new QueryStream("SELECT * FROM users"));
// plug `stream` in wherever `cursor.stream()` was
```

MySQL with `mysql2` streams rows the same way:
```typescript
const stream = connection.query("SELECT * FROM users").stream();
```

DynamoDB uses `scan` with pagination, but you can wrap it in an async generator that yields pages and flattens them — same idea, just more boilerplate around the pagination token.

**Different storage backends, same shape:**

AWS S3 with the v3 SDK:
```typescript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const upload = new Upload({
  client: new S3Client({ region: "us-east-1" }),
  params: {
    Bucket: bucketName,
    Key: fileName,
    Body: readableStream,
    ContentType: "text/csv",
  },
});
await upload.done();
```

Azure Blob Storage:
```typescript
import { BlobServiceClient } from "@azure/storage-blob";

const client = BlobServiceClient.fromConnectionString(connStr);
const container = client.getContainerClient(containerName);
const blob = container.getBlockBlobClient(fileName);
await blob.uploadStream(readableStream, bufferSize, maxConcurrency);
```

Local filesystem (useful for testing or on-premise):
```typescript
import { createWriteStream } from "fs";

const dest = createWriteStream("./export.csv");
await pipeline(source, format({ headers: true }), dest);
```

The only thing that changes is how you create the writable stream at the end. The generator, the CSV formatter, and `pipeline` stay exactly the same.

## When You'll Hit This

This pattern matters any time you're doing bulk data movement:

- Scheduled exports to data warehouses or BI tools
- Compliance reports that need to include all historical records
- Client data exports (GDPR, contractual obligations)
- ETL pipelines between systems
- Audit log dumps for analysis

The mistake of loading everything into memory is easy to make because it works fine during development, passes all your tests on small datasets, and only reveals itself under production load. By then it's usually an incident.

Streaming isn't a premature optimization here. It's the correct default for any export that could grow beyond a few thousand records.
