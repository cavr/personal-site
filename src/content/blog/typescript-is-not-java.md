---
title: TypeScript Is Not Java
description: |
  A lot of TypeScript codebases are just Java with different syntax.
  Classes everywhere, DTOs for everything, layers of abstraction the language never asked for.
publishDate: 2026-03-13 00:00:00
tags:
  - TypeScript
  - Architecture
  - Backend
  - Node.js
---

## The Pattern

You open a TypeScript codebase and find something like this:

```typescript
export class CreateUserDto {
  readonly name: string;
  readonly email: string;
  readonly age: number;

  constructor(name: string, email: string, age: number) {
    this.name = name;
    this.email = email;
    this.age = age;
  }
}

export class UserResponseDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;

  constructor(id: string, name: string, email: string) {
    this.id = id;
    this.name = name;
    this.email = email;
  }
}

export class UserMapper {
  static toResponse(user: User): UserResponseDto {
    return new UserResponseDto(user.id, user.name, user.email);
  }
}
```

There's a `CreateUserDto`, a `UserResponseDto`, a `UserMapper`, and probably a `UserService`, a `UserRepository`, a `UserController`, and an `IUserRepository` interface somewhere too.

This is Java. The file extension says `.ts` but the mental model is Spring Boot.

## What TypeScript Actually Gives You

TypeScript's type system is structural, not nominal. A type is compatible with another if it has the right shape — not because it extends the right class or implements the right interface by name.

That single property changes everything about how you should write typed code.

You don't need a class to describe data. You need an interface or a type alias:

```typescript
interface CreateUserInput {
  name: string;
  email: string;
  age: number;
}

interface UserResponse {
  id: string;
  name: string;
  email: string;
}
```

That's it. No constructor. No `readonly` boilerplate. No instantiation. Just a shape. TypeScript enforces it at compile time. At runtime it costs nothing — interfaces are erased completely.

## The DTO Problem

DTOs (Data Transfer Objects) come from Java and C# where you need a concrete class to serialize and deserialize data. The class carries the shape information at runtime because the language needs it.

TypeScript doesn't need this. JSON serialization doesn't care about class instances. `JSON.stringify` and `JSON.parse` work on plain objects. `fetch`, `axios`, your ORM, your validator library — all of them work with plain objects. There is no technical reason to wrap data in a class.

When you do:

```typescript
const dto = new CreateUserDto(body.name, body.email, body.age);
```

You've created a class instance that behaves identically to:

```typescript
const input = { name: body.name, email: body.email, age: body.age };
```

Except the first one requires a class definition, a constructor, and an instantiation at every call site. The second one is just an object literal.

## When Classes Make Sense

Classes aren't bad. They're the right tool for specific things:

- **Stateful objects** — something that holds state and has methods that operate on it
- **When you need `instanceof` checks** — though this is rarer than you'd think in TypeScript
- **When you're modelling real behavior**, not just data shape

An HTTP client, a database connection pool, a cache — these are good candidates for classes because they have internal state and methods tied to that state.

A payload that goes from a controller to a service is not a candidate for a class. It's data. Model it as data.

```typescript
// This is a class because it has state and behavior
class QueryBuilder {
  private filters: Filter[] = [];
  private limitValue: number = 100;

  where(filter: Filter): this {
    this.filters.push(filter);
    return this;
  }

  limit(n: number): this {
    this.limitValue = n;
    return this;
  }

  build(): Query {
    return { filters: this.filters, limit: this.limitValue };
  }
}

// This is not a class. It's just data.
interface CreateOrderInput {
  userId: string;
  items: { productId: string; qty: number }[];
}
```

## The Mapper Trap

Mapper classes are another Java import that TypeScript doesn't need. The pattern:

```typescript
export class UserMapper {
  static toResponse(user: User): UserResponseDto {
    return new UserResponseDto(user.id, user.name, user.email);
  }

  static toDomain(dto: CreateUserDto): User {
    return new User(dto.name, dto.email, dto.age);
  }
}
```

This is a class with no state, whose only methods are static, and whose only job is to transform one shape into another. In TypeScript, that's a function:

```typescript
function toUserResponse(user: User): UserResponse {
  return { id: user.id, name: user.name, email: user.email };
}
```

One function. No class, no instantiation, no ceremony. Easier to test, easier to compose, easier to read.

## A Quick Note Before the Why

I genuinely love Java. Spring Boot is one of the most well-designed frameworks I've worked with — the IoC container, the ecosystem, the way it handles cross-cutting concerns at scale. It's a pleasure to work with for the problems it was built for.

This post isn't a critique of Java or Spring Boot. It's about using each language for what it is. Java is nominally typed, class-based, and the DTO/mapper/service pattern fits it naturally. TypeScript is structurally typed, runs on a dynamic runtime, and fighting that to make it look like Java produces code that's harder to write and harder to maintain — without gaining anything.

Use the language you're in. Don't carry the previous one with you.

## Why It Happens

People learn Java or C# first. They learn design patterns in a nominally-typed language and those patterns feel like the correct way to structure code — because in that language, they are. When they move to TypeScript, they bring the same instincts.

Framework documentation also plays a role. NestJS is a great framework — I've used it in production and it's a legitimate choice, especially for teams coming from a backend OOP background or building large APIs that benefit from its structure. The decorator-based controllers, the DI system, the module architecture — it's well thought out and it works.

But NestJS is explicitly modeled on Spring Boot, and if you follow its conventions without thinking, you end up replicating the full Java stack inside it: a DTO class for every request, a mapper for every transformation, an interface for every service just so you can inject a different implementation you'll never actually have. NestJS gives you the tools to do this — it doesn't mean you have to use all of them everywhere.

Even inside NestJS, you can keep things lean. Use classes where the framework requires them (controllers, providers, modules). Use interfaces and plain objects everywhere else. Reach for a class-based DTO when you need `class-validator` decorators. Don't reach for one just because the pattern exists.

The over-engineered NestJS version:

```typescript
// create-user.dto.ts
export class CreateUserDto {
  readonly name: string;
  readonly email: string;
}

// user-response.dto.ts
export class UserResponseDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

// user.mapper.ts
export class UserMapper {
  static toResponse(user: User): UserResponseDto {
    return new UserResponseDto(user.id, user.name, user.email);
  }
}

// user.service.interface.ts
export interface IUserService {
  create(dto: CreateUserDto): Promise<UserResponseDto>;
}

// user.service.ts
@Injectable()
export class UserService implements IUserService {
  constructor(private readonly userRepository: UserRepository) {}

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const user = await this.userRepository.create(dto);
    return UserMapper.toResponse(user);
  }
}
```

The same thing, but using NestJS for what it's good at and TypeScript for the rest:

```typescript
// user.types.ts — plain interfaces, no classes
interface CreateUserInput {
  name: string;
  email: string;
}

interface UserResponse {
  id: string;
  name: string;
  email: string;
}

// user.repository.ts — NestJS injectable, talks to the database
@Injectable()
export class UserRepository {
  constructor(private readonly db: PrismaService) {}

  async create(input: CreateUserInput): Promise<UserResponse> {
    const user = await this.db.user.create({ data: input });
    return { id: user.id, name: user.name, email: user.email };
  }
}

// create-user.use-case.ts — business logic, calls the repository
@Injectable()
export class CreateUserUseCase {
  constructor(private readonly userRepository: UserRepository) {}

  async execute(input: CreateUserInput): Promise<UserResponse> {
    // business rules live here — validation, side effects, events, etc.
    return this.userRepository.create(input);
  }
}

// user.controller.ts — thin, just wires HTTP to the use case
@Controller('users')
export class UserController {
  constructor(private readonly createUser: CreateUserUseCase) {}

  @Post()
  create(@Body() input: CreateUserInput) {
    return this.createUser.execute(input);
  }
}
```

Same NestJS. Same DI, same decorators, same module system. Just without the DTO class, the mapper class, and the interface that wraps the service nobody will ever swap out. When you do need validation, that's when a class DTO with decorators earns its place:

```typescript
// only use a class DTO when you actually need class-validator
export class CreateUserDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEmail()
  email: string;
}
```

Use the class because `class-validator` needs it — not as a default for every piece of data that passes through the app.

There's also a sense that more structure means better architecture. Classes, mappers, and DTOs look organized. They look like someone applied patterns. Interfaces and plain functions look almost too simple. But software that's easy to delete, easy to test, and easy to read isn't simple because no thought went into it — it's simple because the right amount of thought went into it.

## What the Simple Version Looks Like

```typescript
// types.ts — just shapes
interface CreateUserInput {
  name: string;
  email: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

// user.service.ts — functions that operate on those shapes
async function createUser(input: CreateUserInput): Promise<User> {
  const user = await db.users.create({
    data: { ...input, createdAt: new Date() },
  });
  return user;
}

// user.controller.ts — thin, just wires HTTP to the function
app.post('/users', async (req, res) => {
  const user = await createUser(req.body);
  res.json(user);
});
```

No DTOs. No mappers. No class hierarchies. TypeScript enforces the types at compile time, the runtime is plain objects, and the code is readable at a glance.

If you need validation at the boundary, reach for a library like Zod that validates and infers types at once:

```typescript
const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

type CreateUserInput = z.infer<typeof CreateUserSchema>;

app.post('/users', async (req, res) => {
  const input = CreateUserSchema.parse(req.body); // validates and types in one step
  const user = await createUser(input);
  res.json(user);
});
```

One schema, one type, one validation step. No class, no constructor, no mapper, no DTO.

TypeScript is already doing the heavy lifting. Let it.
