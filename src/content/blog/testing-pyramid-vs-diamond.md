---
title: The Testing Pyramid Is Wrong (For Most Apps)
description: |
  Thousands of unit tests, a handful of integration tests, and a prayer.
  Why the classic pyramid gives you false confidence, and what to test instead.
publishDate: 2026-03-13 00:00:00
tags:
  - Testing
  - Backend
  - Architecture
  - Engineering
---

## The Pyramid

You've seen it. Every testing talk, every onboarding doc, every "best practices" article:

```
        /\
       /  \
      / E2E\
     /------\
    /  Integ  \
   /------------\
  /  Unit Tests  \
 /________________\
```

Lots of unit tests at the base. Some integration tests in the middle. A few end-to-end tests at the top. The reasoning: unit tests are fast and cheap, E2E tests are slow and brittle, so lean on unit tests and treat the rest as a supplement.

It's not wrong in theory. In practice, it produces codebases with thousands of unit tests and systems that still break in production in ways none of those tests predicted.

## The Unit Test Trap

A unit test tests one thing in isolation — a function, a class, a module — with everything else mocked out. The appeal is obvious: fast, deterministic, easy to write, easy to understand.

The problem is what you end up testing.

```typescript
// A unit test that passes with flying colors
it('should call userRepository.create with the correct input', async () => {
  const mockRepo = { create: jest.fn().mockResolvedValue({ id: '1', name: 'Alice' }) };
  const useCase = new CreateUserUseCase(mockRepo);

  await useCase.execute({ name: 'Alice', email: 'alice@example.com' });

  expect(mockRepo.create).toHaveBeenCalledWith({
    name: 'Alice',
    email: 'alice@example.com',
  });
});
```

This test passes. It will always pass. It tests that your code calls the mock the way you told it to. It tells you absolutely nothing about whether the system works.

The repository is mocked. The database is not involved. If the real repository has a bug, if the SQL query is wrong, if the schema doesn't match the input — this test doesn't catch it. It never could. You've tested your assumptions, not your code.

This is the unit test trap: you accumulate hundreds of tests that give you a green CI badge and zero confidence in the actual behavior of the system.

## What Actually Breaks in Production

Think about the last few real production bugs you've seen or heard about. How many of them were a pure logic error inside a single function? And how many of them were:

- A query that worked differently than expected
- A third-party API returning a shape the code didn't handle
- Two services interacting in a way nobody tested
- A database constraint that wasn't reflected in the code
- A migration that changed behavior nobody caught
- An environment variable missing in production

Almost all production bugs live at the boundaries — between your code and the database, between services, between your system and the outside world. Unit tests, by design, mock those boundaries away.

## The Diamond

A more useful shape for most applications:

```
        /\
       /  \
      / E2E\
     /------\
    /        \
   / Integra  \
  /   tion     \
 /--------------\
  \  Unit Tests /
   \           /
    \  (few)  /
     \_______/
```

Fewer unit tests. Many more integration tests. This is sometimes called the testing trophy or the testing diamond. The idea: write tests at the level that gives you the most confidence per test written.

An integration test that spins up your real database, runs a real query, and checks the real output tells you more than ten unit tests that mock the database.

## Integration Tests Are Not Hard

The common objection: integration tests are slow and complex to set up. This used to be truer than it is now.

But before jumping to the most sophisticated tooling, consider the simplest option first: **a shared local database for tests**. A dedicated test database running on your machine or in CI, seeded before the suite and wiped after, is often all you need. No Docker, no containers, no orchestration. Just a connection string pointing at a test schema.

```typescript
// .env.test
DATABASE_URL=postgresql://localhost:5432/myapp_test

// Before your suite runs, wipe and reseed:
// npx prisma migrate reset --force
```

That's it for many projects. It's fast, zero config, and perfectly sufficient for a team of one to five people running tests locally and in CI.

`testcontainers` is the next step up — it spins up an isolated, fresh database per test suite using Docker, which means no shared state between runs and no manual database management. Useful when you have multiple developers with different local setups, or when you want full isolation in CI. But it adds Docker as a dependency, increases test startup time, and requires more setup. It can absolutely be overkill for a small API or an early-stage product.

With that said, if you do need it:

With Docker and tools like `testcontainers`, spinning up a real Postgres or MongoDB instance for a test suite is a few lines of config:

```typescript
// Jest + testcontainers — real Postgres, real queries
beforeAll(async () => {
  const container = await new PostgreSqlContainer().start();
  db = await createConnection(container.getConnectionUri());
  await runMigrations(db);
});

afterAll(async () => {
  await container.stop();
});

it('should create a user and return it with an id', async () => {
  const repo = new UserRepository(db);
  const user = await repo.create({ name: 'Alice', email: 'alice@example.com' });

  expect(user.id).toBeDefined();
  expect(user.name).toBe('Alice');
  expect(user.email).toBe('alice@example.com');
});
```

This test uses a real database. It runs your real migration. It executes a real query. If there's a column missing, a constraint violated, a type mismatch — it fails. And it runs in a few hundred milliseconds.

That one test replaces five or six mocked unit tests and tells you ten times more.

## When Unit Tests Are the Right Call

Unit tests aren't useless. They're the right tool for one specific thing: **heavy, complex business logic that has nothing to do with I/O**.

If you have a function that calculates tax rates across jurisdictions, processes financial transactions with rounding rules, runs a pricing algorithm with multiple edge cases, or validates complex domain rules — that deserves unit tests. Lots of them. Covering every edge case, every boundary value, every combination that matters.

```typescript
// This deserves unit tests — pure logic, many edge cases
describe('calculateOrderDiscount', () => {
  it('should apply 10% for orders over 100', () => {
    expect(calculateOrderDiscount(150, 'standard')).toBe(15);
  });

  it('should apply 20% for premium users regardless of amount', () => {
    expect(calculateOrderDiscount(50, 'premium')).toBe(10);
  });

  it('should not apply discount below minimum order value', () => {
    expect(calculateOrderDiscount(30, 'standard')).toBe(0);
  });

  it('should cap discount at maximum regardless of percentage', () => {
    expect(calculateOrderDiscount(10000, 'premium')).toBe(200);
  });
});
```

Pure functions with complex rules are the sweet spot for unit tests. Fast, no setup, deterministic, and the logic is genuinely isolated — there's nothing else involved.

The mistake is applying that same approach to code that's mostly wiring — calling a repository, transforming a response, routing a request. That code doesn't have complex logic. It has I/O. Test it with I/O.

## The False Confidence Problem

The most damaging thing about a test suite heavy on mocks is that it creates confidence that isn't real. Green CI feels like safety. Developers merge changes because the tests pass. The tests were always going to pass — they're testing the mocks, not the system.

Then something changes in the database schema. Or a library updates its behavior. Or an environment variable is configured differently. And the tests are still green, right up until the moment production breaks.

A smaller test suite with real integration tests would have caught it. It runs slower. The CI badge might take an extra two minutes. But when it's green, it means something.

## What to Actually Do

- **Integration test your repositories and services** against real databases. Use testcontainers or a test database. This is your most valuable layer.
- **Integration test your API endpoints** end-to-end through the HTTP layer. Send a real request, check the real response. Tools like Supertest make this easy in Node.js.
- **Unit test pure business logic** — pricing, validation rules, calculations, algorithms. Anything with complex branching and no I/O.
- **Don't unit test wiring.** Controllers that call services, services that call repositories, mappers that transform data — if there's no complex logic, a unit test tells you nothing useful.

The goal isn't to maximize the number of tests. It's to maximize confidence per test written. A hundred unit tests that mock everything give you less confidence than ten integration tests against real dependencies.

Test the system, not your assumptions about the system.
