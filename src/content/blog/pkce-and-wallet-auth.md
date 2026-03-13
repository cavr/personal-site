---
title: PKCE, Wallet Auth, and the Challenge-Response Pattern
description: |
  Two different auth flows, one shared idea. How PKCE protects OAuth public clients,
  how wallet-based sign-in works, and what they have in common.
publishDate: 2026-03-13 00:00:00
tags:
  - Security
  - OAuth
  - Authentication
  - Web3
  - Backend
---

## The Problem with Public Clients

Server-side apps can keep a secret. They store a `client_secret`, send it with every token request, and the auth server knows the request is legitimate.

Mobile apps and SPAs can't. Any secret you ship in a JavaScript bundle or a compiled app can be extracted. There's no such thing as a confidential public client.

So what stops an attacker who intercepts your authorization code from exchanging it for tokens themselves? Without any additional protection, nothing.

That's the problem PKCE solves.

## PKCE: Proof Key for Code Exchange

PKCE (RFC 7636) extends the OAuth Authorization Code flow so that only the client that *started* the flow can finish it — without needing a static secret.

The idea is a one-time cryptographic proof generated fresh for each login attempt.

### How it works

```
Client                          Authorization Server
  |                                      |
  |-- 1. Generate code_verifier          |
  |       (random string, 43-128 chars)  |
  |                                      |
  |-- 2. Derive code_challenge           |
  |       SHA256(code_verifier) → Base64URL
  |                                      |
  |-- 3. Auth Request + code_challenge ->|
  |       (server stores the challenge)  |
  |                                      |
  |<-- 4. Authorization Code ------------|
  |                                      |
  |-- 5. Token Request + code_verifier ->|
  |       server runs:                   |
  |       SHA256(verifier) == challenge? |
  |                                      |
  |<-- 6. Access Token -----------------|
```

**Step 1 — Generate the verifier**

```python
import secrets
code_verifier = secrets.token_urlsafe(64)  # cryptographically random
```

**Step 2 — Derive the challenge**

```python
import hashlib, base64
digest = hashlib.sha256(code_verifier.encode()).digest()
code_challenge = base64.urlsafe_b64encode(digest).rstrip(b'=').decode()
```

**Step 3 — Authorization request**

```
GET /authorize?
  response_type=code
  &client_id=...
  &redirect_uri=...
  &code_challenge=<code_challenge>
  &code_challenge_method=S256
  &state=...
```

**Step 4 — Token exchange**

```
POST /token
  grant_type=authorization_code
  &code=<auth_code>
  &redirect_uri=...
  &code_verifier=<code_verifier>
  &client_id=...
```

The server re-hashes the verifier and checks it against what it stored. Match → tokens issued. No match → rejected.

### Who holds what

- **Client** keeps the `code_verifier` — the raw secret, never sent until the final step
- **Server** keeps the `code_challenge` — the hash, tied to the authorization code it issued

An attacker who intercepts the authorization request gets the `code_challenge`. An attacker who intercepts the redirect gets the `code`. Neither is enough. They'd need the `code_verifier` too, which never leaves the originating client.

### Always use S256, never plain

`code_challenge_method=plain` means `code_challenge == code_verifier`. Anyone who sees the initial auth request has everything they need. `S256` means you'd need to reverse SHA-256 to get from the challenge back to the verifier. That's not happening.

## Wallet Auth: The Same Idea, Different Cryptography

There's a pattern used in Web3 authentication — Sign-In with Ethereum (SIWE) and similar flows — that follows the same challenge-response shape, but uses asymmetric cryptography instead of hashing.

The server issues a challenge. The client proves they control a private key by signing it. The server verifies the signature against the public wallet address.

```
Client                          Server
  |                                |
  |-- 1. Request challenge ------->|
  |       + wallet address         |
  |                                |
  |<-- 2. Random nonce ------------|
  |       (tied to that address)   |
  |                                |
  |-- 3. Sign nonce with wallet    |
  |                                |
  |-- 4. Send signature ---------->|
  |                                |
  |   5. Server recovers address   |
  |      from signature, checks    |
  |      it matches stored address |
  |<-- 6. Authenticated -----------|
```

The server never sees the private key. It just uses the public wallet address to verify the signature — asymmetric crypto means only the holder of the private key could have produced that exact signature for that exact nonce.

### Send the address upfront

Some implementations send the wallet address in step 4 alongside the signature. But it's cleaner to send it in step 1 when requesting the challenge:

- The server ties the nonce to that address from the start
- Step 4 is just the signature — less surface area for mistakes
- No ambiguity about which address is being claimed at verification time

### Storing challenges in MongoDB

The server needs to temporarily store the mapping between wallet address and nonce until the signature comes back. A simple document:

```json
{
  "wallet": "0x1234...abcd",
  "nonce": "f3a9c2...",
  "createdAt": "2026-02-27T10:00:00Z"
}
```

Once verified, discard it immediately — a nonce that can be reused is a replay attack waiting to happen.

For automatic cleanup, put a TTL index on `createdAt`:

```js
db.challenges.createIndex({ createdAt: 1 }, { expireAfterSeconds: 300 })
```

MongoDB deletes stale challenges after 5 minutes, no cron job needed.

## The Pattern Underneath Both

PKCE and wallet auth look different on the surface but share the same structure:

| | PKCE | Wallet Auth |
|---|---|---|
| Client generates | `code_verifier` (random string) | private key signature |
| Client sends upfront | `code_challenge` (hash of verifier) | wallet address |
| Server stores | `challenge` tied to auth code | `nonce` tied to wallet address |
| Client proves later | sends raw `code_verifier` | sends signature |
| Server verifies by | hashing verifier, comparing | recovering address from signature |
| Crypto type | Symmetric (SHA-256) | Asymmetric (ECDSA) |

Both are challenge-response protocols. The client commits to something upfront, and later proves they were the one who made that commitment — without ever sending the actual secret directly.

The nonce / verifier is what makes both flows replay-proof. Capture the challenge, capture the code, capture the signature — none of it is reusable without the original secret that produced it.
