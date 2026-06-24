# Building on b3nd — a field book

> Canon → Domain PIN → App → Rig.
> Start with the data. Grow into behavior. Compose behaviors into a node.

This is a guided, example-first book about building real systems on top of
`@bandeira-tech/b3nd-core`. The core gives you a tiny, protocol-agnostic
foundation — a `Rig` that routes `Output` tuples through a pipeline of
clients, programs, handlers, hooks, and reactions. It deliberately has *no
opinion* about your data, your URIs, or your domain rules.

This book is about the opinions you layer on top, and the shape those layers
should take so that you can **build data-first** and **ship behaviors that
compose**.

## The idea in one breath

You build **bottom-up**:

1. **Canon** — your data models and the URIs that address them. Pure. No I/O.
2. **Domain PIN** — a `ProtocolInterfaceNode` that stores and serves one slice
   of the URI space.
3. **App** — a named, namespaced bundle of behavior (programs, handlers,
   reactions, hooks) over a Canon. This is the unit you *ship*.
4. **Rig** — many Apps composed into a single node that serves many behaviors
   at once.

Then you compose: `new Rig(composeApps([profilesApp(...), postsApp(...), ...]))`.

## How to read this book

Each chapter grows **the same protocol** — `chirp://`, a small microblog — by
adding one layer or one behavior. Nothing is thrown away between chapters; the
profile store you build in Chapter 2 is still there in Chapter 7 when the whole
thing goes distributed. The difficulty ramps; the domain stays familiar.

Every snippet uses the *real* core API. Where a README elsewhere in this repo
is loose (e.g. handlers shown as `msg.payload` — the real signature is an
`Output` tuple `[uri, payload]`), this book uses the authoritative form.

## Table of contents

| #  | Chapter | What you learn | New core surface |
|----|---------|----------------|------------------|
| 1  | [The model](./01-the-model.md) | The four layers and why they exist | — |
| 2  | [Hello, data](./02-hello-data.md) | A Canon + a Domain PIN + a bare Rig: write and read | `Rig`, `connection`, `Output` |
| 3  | [Your first App](./03-your-first-app.md) | Validation as a Program + handler; the `App` shape | `Program`, `CodeHandler` |
| 4  | [Reactions & events](./04-reactions-and-events.md) | Derived read-models, counters, notifications | `reactions`, `on` events |
| 5  | [Composing Apps](./05-composing-apps.md) | Many behaviors, one node; `composeApps` | `composeApps`, `observe` |
| 6  | [Policy & identity](./06-policy-and-identity.md) | Signed writes and cross-cutting policy via hooks | `Identity`, `hooks` |
| 7  | [Going distributed](./07-going-distributed.md) | Replicate the protocol across peers | `network`, `peer`, `flood` |
| 8  | [Reference](./08-reference.md) | The `App`/`composeApps` primitive, merge rules, glossary | — |

## A note on scope

The only piece this book introduces that isn't in core today is the **App
composition primitive** (`App` + `composeApps`), shown in full in
[Chapter 8](./08-reference.md). It's ~70 lines of pure config algebra over
`RigConfig`; you can paste it into your project or lift it into core. Everything
else — Canons, Domain PINs — lives *above* core, by design, so that core stays
protocol-neutral.

Turn to [Chapter 1](./01-the-model.md) to meet the four layers.
</content>
</invoke>
