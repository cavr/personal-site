---
title: Overengineering Kills Projects
description: |
  It usually starts with good intentions. A clean architecture, a scalable design,
  doing things the right way. And then the project never ships.
publishDate: 2026-03-13 00:00:00
tags:
  - Engineering
  - Architecture
  - Teams
---

## It Always Starts with Good Intentions

Nobody sits down and thinks "I'm going to make this unnecessarily complex." Overengineering doesn't come from laziness or arrogance — it usually comes from caring. From wanting to do things properly. From having seen a mess before and not wanting to build another one.

That's worth saying upfront, because the conversation around overengineering often turns condescending. "Just keep it simple." "YAGNI." As if the people who over-build are just confused about basics.

They're not. They're often the most experienced engineers on the team. They've seen what happens when you cut too many corners. They're trying to prevent that. The problem is that the solution they reach for introduces a different kind of failure — slower, quieter, but just as damaging.

## What It Actually Looks Like

It's rarely obvious in the moment. It shows up as:

- A microservices architecture for an app with two developers and a hundred users
- An event-driven system with a message broker for a workflow that runs once a day
- Five layers of abstraction around a database call that will never change
- A plugin system designed for extensibility that nobody will ever extend
- Months spent on infrastructure before a single user has validated the product

Each of these decisions has a justification. The team has heard about service meshes and wants to be ready. Someone read about the strangler fig pattern and it made sense. The senior engineer knows from experience that databases change, so they wrapped everything.

The justifications are reasonable. The timing is wrong.

## Why It Happens

**Resume-driven development.** This is the uncomfortable one. New technologies are genuinely interesting, and engineers are human. Working with Kubernetes, event sourcing, or a custom DSL is more professionally interesting than shipping a CRUD app. It's not cynical to acknowledge that what ends up in production sometimes reflects what the team wanted to learn, not just what the product needed.

**Anxiety about future scale.** "What if we need to handle a million users?" is a real question, but it's often asked before question zero: "Do we have any users?" Designing for scale you don't have costs time you do have. The projects that reach a million users are almost never the ones that designed for it from day one — they're the ones that shipped something, got users, and then had the problem of scaling.

**Fear of being blamed for a bad decision.** If you build something simple and it breaks at scale, that's on you. If you build something complex and nobody questions it, you're safe. Over-engineering can be a form of defensive architecture — hard to criticize, hard to hold accountable for, because the complexity itself signals effort.

**The sunk cost spiral.** Once a team has invested three months in an abstraction, it becomes very hard to throw it away. So they keep building on it. The abstraction that was unnecessary in month one becomes load-bearing by month six, not because it was ever right, but because backing out of it is now more expensive than continuing.

## What It Costs

The most visible cost is speed. A team spending time on infrastructure isn't spending time on features. A developer untangling abstraction layers isn't shipping. This is real, it compounds, and it's where most overengineered projects die — not in a dramatic failure, but in a slow accumulation of friction until the project loses momentum and gets shelved.

But there are subtler costs too.

**Onboarding becomes expensive.** A new engineer joining a simple codebase can be productive in days. A new engineer joining a system with custom event buses, domain-specific abstractions, and twelve layers between a request and a database response needs weeks just to form a mental model. That knowledge is not documented. It lives in the heads of the people who built it, and those people are often not around anymore.

**The complexity accretes.** Overengineered systems attract more overengineering. Once there's an event bus, someone adds more event types. Once there's an abstraction layer, someone adds more abstractions on top. The initial complexity is a template. New code follows the pattern. By the time someone realizes the pattern was wrong, it's everywhere.

**Debugging becomes archaeology.** When something breaks in a simple system, you find it. When something breaks in a system with six indirection layers, three async event queues, and a plugin architecture, you spend a day figuring out which layer is responsible before you can even start fixing it.

## Don't Reinvent the Wheel

One specific failure mode deserves its own mention: building things that already exist, better, for free.

Auth systems. Queuing systems. Search. File storage. Payment processing. Caching layers. These are solved problems with mature, production-tested solutions. Building your own because you want full control, or because the existing solution "doesn't fit perfectly," is almost never worth it.

The existing solution has edge cases you haven't thought of yet. It has been broken in production by teams smarter than yours, fixed, and hardened. It has documentation, community knowledge, and Stack Overflow answers. Your homegrown version has none of that on day one.

Use the boring tool. Reach for the library. The custom solution is justified when the existing ones genuinely can't do what you need — not when they can't do it in exactly the way you'd prefer.

## The Right Amount of Architecture

There's no formula. But there are useful questions:

**What problem are you solving right now, not in six months?** Design for the problem in front of you. If a new problem appears in six months, you'll have more information then than you do today, and you'll be better positioned to solve it correctly.

**Can you explain this to a new engineer in ten minutes?** If the answer is no, the complexity is probably not justified by the requirements. Complexity that can't be explained is complexity that can't be maintained.

**What happens if this is wrong?** Some architectural decisions are easy to change later. Others calcify. The ones that calcify deserve more upfront thought. The ones that are easy to change don't need to be perfect now.

**Is this solving a problem you have, or a problem you're afraid of having?** There's a difference. Both deserve consideration, but they deserve different weights. Real problems get solved now. Hypothetical problems get noted and deferred until they're real.

## Simplicity Is a Skill

This isn't an argument for sloppy code or cutting corners on correctness. Simple systems can be well-structured, well-tested, and well-documented. Simplicity is not the absence of thought — it's the result of enough thought to know what to leave out.

The engineers who consistently ship working software aren't the ones who don't know about microservices or event sourcing. They know all of it. They just have a calibrated sense of when it's actually needed. They've seen enough projects fail from too much complexity that they've developed a healthy resistance to it.

That calibration is hard-won. It usually comes from having shipped something overengineered, watched it slow down and collapse under its own weight, and carrying that experience into the next project.

The goal isn't to never make the mistake. It's to recognize it faster each time.
