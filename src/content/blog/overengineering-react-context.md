---
title: You Don't Need Context for That
description: |
  Why developers keep wrapping React Query in Context providers, and why the simpler
  approach — a custom hook — is faster, more testable, and easier to maintain.
publishDate: 2026-03-13 00:00:00
tags:
  - React
  - TypeScript
  - Architecture
  - Frontend
---

## The Pattern You've Seen a Hundred Times

You open a codebase and find something like this:

```tsx
// UserContext.tsx
const UserContext = createContext<User | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const { data: user } = useQuery({ queryKey: ['user'], queryFn: fetchUser });
  return <UserContext.Provider value={user ?? null}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext);
}
```

Then `UserProvider` is wrapped around the whole app, or at least a large chunk of it. And it's used like:

```tsx
const user = useUser();
```

It looks clean. It looks structured. It looks like someone thought carefully about architecture.

It's also completely unnecessary.

## Why This Happens

**Habit.** Context was the "official" React way to share state before tools like React Query existed. Developers learned it early, used it everywhere, and keep reaching for it out of muscle memory. The pattern is so ingrained that it gets applied even when the problem has already been solved by a library sitting in the same `package.json`.

**Not understanding the tools.** React Query handles caching, deduplication, and shared state internally. If two components both call `useQuery({ queryKey: ['user'], queryFn: fetchUser })`, React Query does not fire two network requests. It fires one, caches the result, and serves it to both. The whole point of the query key is to be a shared cache key across the application. Wrapping it in Context adds a layer that the library already provides.

**Over-abstraction.** Wrapping everything in a provider makes the architecture look more "enterprise." There are layers. There are boundaries. It looks structured. But structure and complexity are not the same thing. You've added an indirection that gives you nothing in return — no performance benefit, no cleaner API, no easier testing.

**Copy-paste culture.** Someone saw this pattern in a blog post, a boilerplate repo, or a senior dev's code five years ago, and replicated it without questioning whether it still makes sense. Patterns spread faster than understanding.

## What You Actually Need

Just a custom hook:

```tsx
// useUser.ts
export function useUser() {
  return useQuery({ queryKey: ['user'], queryFn: fetchUser });
}
```

That's it. Call it in any component that needs the user:

```tsx
// ComponentA.tsx
const { data: user } = useUser();

// ComponentB.tsx — rendered elsewhere in the tree
const { data: user } = useUser();
```

React Query sees the same query key, returns the cached data, and fires zero extra requests. Both components are in sync. No provider. No Context. No `useContext`. No wrapper component to maintain.

## If You Want Data to Always Be Ready: `useSuspenseQuery`

One argument people make for the Context pattern is that they want to guarantee the data is already loaded before child components render — avoiding the `if (!user) return null` guards scattered everywhere.

React Query has a built-in answer for that: `useSuspenseQuery`.

```tsx
// useUser.ts
export function useUser() {
  return useSuspenseQuery({ queryKey: ['user'], queryFn: fetchUser });
}
```

```tsx
// Profile.tsx — data is guaranteed to be defined here
function Profile() {
  const { data: user } = useUser(); // no null check needed
  return <h1>{user.name}</h1>;
}

// App.tsx
<Suspense fallback={<Spinner />}>
  <Profile />
</Suspense>
```

`useSuspenseQuery` suspends the component while the query is loading, so by the time it renders, `data` is always defined — no `undefined`, no loading state to handle locally. The loading UI lives in the `<Suspense>` boundary, which you control at whatever level makes sense.

This is exactly what the Context pattern was trying to achieve — "data is ready before children render" — but without the provider, without the wrapper, and with proper Suspense semantics baked in.

The TypeScript types reflect this too: with `useQuery`, `data` is `User | undefined`. With `useSuspenseQuery`, `data` is `User`. The guarantee is encoded in the type.

## Why the Simpler Version Is Actually Better

**Performance.** The Context version re-renders every consumer whenever the provider's value changes. React Query's internal subscriptions are more granular — components re-render only when the data they care about changes.

**Testability.** Testing a component that uses `useUser()` directly means mocking the query. Testing a component that uses Context means either wrapping it in a provider in every test or mocking Context. The hook is simpler to isolate.

**Colocation.** With Context, you need to decide where in the tree to place the provider. That decision becomes load-bearing — move the provider too high and you're initializing data early; too low and consumers can't access it. With a hook, each component fetches what it needs and React Query handles the rest.

**Less code.** The Context version requires a context object, a provider component, a custom hook wrapping `useContext`, and the original `useQuery` call. The direct version is one function that wraps one call.

## When Context Actually Makes Sense

Context is not bad. It's just frequently misused for things React Query already handles.

Context is the right tool for:

- **Theme / UI state** — dark mode, locale, feature flags. Things that are truly global, change infrequently, and don't come from a server.
- **Values that have no async lifecycle** — a design system's configuration, a logged-in user's ID after it's been resolved, a router context.
- **Dependency injection for testing** — passing mock implementations into a component tree without prop drilling.

If the value comes from an API call, React Query owns it. If the value is client-side UI state, `useState` or a state manager owns it. Context is for ambient configuration that the whole tree needs to read, not for ferrying server data around.

## The Irony

The developers who add the Context layer often do it to make the codebase "easier to manage." But the result is the opposite. Now there's a provider that needs to be mounted. Tests need setup. New devs have to trace through the Context to understand where data comes from. And if you ever want to add loading states, error handling, or background refetching — React Query already does all of that, while the Context layer silently discards it.

The simpler approach is more performant, more testable, and easier to understand. It just doesn't look as sophisticated, so people skip it.

Less code. Fewer abstractions. Let the tools do their job.
