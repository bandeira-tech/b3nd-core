# Modeling LangWatch on b3nd

A study of how [LangWatch](https://github.com/langwatch/langwatch) (open-source
LLM observability) handles data, and how that data model could be expressed on
b3nd's primitives (`Output = [uri, payload]`, `receive`/`read`/`observe`,
programs, handlers, reactions, identity, network).

This is an exploratory design note, not a shipped feature. Nothing here adds
code to b3nd-core — the point is to show that b3nd's addressing + routing +
event-sourcing model is a natural fit for an observability backend.

---

## 1. How LangWatch deals with data

### 1.1 The entity hierarchy

LangWatch is OpenTelemetry/OTLP-native. Its core observability data is a strict
nesting:

```
Project (tenant)
└── Thread          (a whole user session)
    └── Trace       (one end-to-end task; trace_id)
        ├── Span    (a unit of work; span_id, parent_id → tree)
        ├── Event   (custom timeline events)
        └── Evaluation (quality/guardrail result per trace or span)
```

Plus the "library" entities used to drive the
*trace → dataset → evaluate → optimize → re-test* loop:

- **Dataset** — versioned collections of records for testing.
- **Prompt** — versioned, Git-backed prompt definitions.
- **Annotation** — human labels/feedback on traces (edge cases, scoring).

### 1.2 Concrete shapes (from `server/tracer/types.ts`)

**Trace**

```ts
{
  trace_id: string;
  project_id: string;
  metadata: {
    thread_id?; user_id?; customer_id?; labels?: string[];
    topic_id?; subtopic_id?;
    sdk_name?; sdk_version?; sdk_language?;
    prompt_ids?: string[]; prompt_version_ids?: string[];
    // + custom metadata
  };
  timestamps: { started_at; inserted_at; updated_at };
  input?; output?; expected_output?;
  contexts?: RAGChunk[];
  metrics?: {                       // rollups computed at ingest
    first_token_ms?; total_time_ms?;
    prompt_tokens?; completion_tokens?; reasoning_tokens?;
    cache_read_input_tokens?; cache_creation_input_tokens?;
    total_cost?; tokens_estimated?;
  };
  error?: ErrorCapture | null;
  events?: Event[];
  evaluations?: Evaluation[];
  spans: Span[];
}
```

**Span** (`Span = LLMSpan | RAGSpan | BaseSpan`)

```ts
BaseSpan {
  span_id; parent_id?; trace_id;
  type: "span" | "llm" | "chain" | "tool" | "agent" | "rag"
      | "guardrail" | "evaluation" | "workflow" | "component"
      | "module" | "server" | "client" | "producer" | "consumer"
      | "task" | "unknown";
  name?;
  input?: SpanInputOutput;          // typed-value union (below)
  output?: SpanInputOutput;
  error?; timestamps; metrics?; params?;
}
LLMSpan extends BaseSpan { type: "llm"; vendor?; model? }
```

`SpanInputOutput` is a recursive **typed-value union** — the payload carries its
own shape tag:

```ts
{ type: "text",              value: string }
{ type: "chat_messages",     value: ChatMessage[] }
{ type: "json",              value: JSONSerializable }
{ type: "guardrail_result",  value: EvaluationResult }
{ type: "evaluation_result", value: EvaluationResult }
{ type: "raw",               value: string }
{ type: "list",              value: SpanInputOutput[] }
```

**Evaluation**

```ts
{
  evaluation_id; evaluator_id; span_id?; name; type?;
  is_guardrail?;
  status: "scheduled" | "in_progress" | "error" | "skipped" | "processed";
  passed?; score?; label?; details?; inputs?;
  error?; retries?; timestamps;
}
```

### 1.3 Storage & ingestion

LangWatch is polyglot:

| Store              | Holds                                                     |
| ------------------ | -------------------------------------------------------- |
| **Elasticsearch / OpenSearch** | Traces + spans — search, filtering, analytics |
| **PostgreSQL**     | Projects, users, API keys, prompts, datasets, annotations |
| **ClickHouse**     | Analytics / time-series rollups                          |
| **Redis**          | Queues for async evaluation/guardrail workers            |

Ingestion is a fan-in-then-decompose pipeline: an SDK/OTLP exporter posts a
trace → a collector validates and normalizes it → workers split it into
spans/events, compute rollup metrics (cost, tokens, latency), index into ES,
and enqueue evaluations/guardrails onto Redis. Evaluation workers run async and
write results back. The dashboard reads from ES and reacts to new data.

The shape worth noting: **append a composite document, then decompose and
aggregate, then trigger downstream async work.** That is event-sourcing.

---

## 2. b3nd in one paragraph

Everything is `Output = [uri, payload]`. A `ProtocolInterfaceNode` exposes four
primitives — `receive` (writes, keyed by uri), `read` (queries; `fn=read|ls|
count|x-*` encoded in the locator), `observe` (uri-change stream), `status`. A
**Rig** routes each operation to clients by **segment-glob URI patterns**.
**Programs** classify an incoming output by uri prefix into a code; **handlers**
turn a code into the `Output[]` to actually persist (persist / decompose /
refuse). **Reactions** fire on successful writes matching a uri pattern.
**Identity** (Ed25519) signs/verifies. **Network** replicates writes across
peers. The framework never interprets payloads — content shape is the client's
contract.

The mechanical correspondence is almost one-to-one:

| LangWatch                         | b3nd                                              |
| --------------------------------- | ------------------------------------------------- |
| OTLP collector endpoint           | `rig.receive(...)`                                |
| ES document id                    | the `uri`                                         |
| ES/PG/ClickHouse polyglot storage | Rig **routes** per uri prefix to different clients |
| Ingest normalization/validation   | **Program** (classify) + **handler** (decompose)  |
| Redis eval/guardrail queue        | **Reaction** on `…/traces/*`                      |
| Live dashboard updates            | **observe**                                       |
| Typed-value span input/output     | the opaque **payload** (kept verbatim)            |
| API-key auth + project scoping     | **Identity** + `beforeReceive` hook              |
| Analytics queries                 | `x-*` extension `fn`s on the analytics client     |

---

## 3. URI namespace

Map the hierarchy to a uri tree. Mutable, evolving records use `mutable://`;
immutable versioned artifacts use content-addressed `hash://`.

```
# telemetry (mutable, search/analytics backend)
mutable://lw/<project>/threads/<thread_id>
mutable://lw/<project>/traces/<trace_id>
mutable://lw/<project>/traces/<trace_id>/spans/<span_id>
mutable://lw/<project>/traces/<trace_id>/events/<event_id>
mutable://lw/<project>/traces/<trace_id>/evaluations/<eval_id>

# secondary index: a thread's traces (write both; or derive via reaction)
mutable://lw/<project>/threads/<thread_id>/traces/<trace_id>   → link

# library (immutable versions + a mutable "current" pointer)
hash://lw/<project>/datasets/<dataset_id>/<version_hash>
hash://lw/<project>/prompts/<prompt_id>/<version_hash>
mutable://lw/<project>/prompts/<prompt_id>                     → current version uri
mutable://lw/<project>/annotations/<annotation_id>
```

Why the split:

- **Traces/spans/evals are mutable, queryable, high-volume** → a search-engine
  backend (ES/OpenSearch) fronted by a b3nd `Store` adapter.
- **Datasets and prompt versions are immutable and content-addressed** —
  `hash://…/<version_hash>` is literally how b3nd models versioned blobs, and it
  gives dedup + integrity for free. A `mutable://…/prompts/<id>` row holds the
  pointer to the current version (the "Git ref").
- **Projects/users/keys** are relational and transactional → keep them in a
  Postgres-backed client. (See §6 — this is the part of LangWatch that does *not*
  fit a uri-KV model and shouldn't be forced into one.)

### Reads

```ts
// trace detail screen — one round-trip
const [trace, spanCount, spanUris] = await rig.read([
  "mutable://lw/acme/traces/t_123",
  "mutable://lw/acme/traces/t_123/spans/?fn=count",
  "mutable://lw/acme/traces/t_123/spans/?format=uris&sortBy=timestamp",
]);

// a thread's trace list, newest first, paged
await rig.read([
  "mutable://lw/acme/threads/sess_9/traces/?limit=20&page=1" +
    "&sortBy=timestamp&sortOrder=desc",
]);
```

Full-text search and analytics that don't reduce to ls/count are exposed as
provider `x-*` functions on the backing client (per `docs/backends.md` §5):

```ts
buildUrl({
  uri: "mutable://lw/acme/traces/",
  fn: "x-lw.search",
  params: { limit: 50 },
  ext: { "x-lw.query": "error AND model:gpt-4o", "x-lw.from": "2026-06-01" },
});

buildUrl({
  uri: "mutable://lw/acme/traces/",
  fn: "x-lw.aggregate",                       // → ClickHouse-backed client
  ext: { "x-lw.metric": "total_cost", "x-lw.groupBy": "model", "x-lw.bucket": "day" },
});
```

---

## 4. Ingestion as receive → program → handler → reaction

This is where the fit is strongest. LangWatch's "collect a trace, split it,
roll up metrics, enqueue evals" becomes the b3nd write pipeline verbatim.

```ts
// 1. The SDK/OTLP exporter posts the whole trace as one write.
await rig.receive([[
  "mutable://lw/acme/traces/t_123",
  { /* OTLP-shaped trace with nested spans/events */ },
]]);
```

```ts
const rig = new Rig({
  routes: {
    receive: [
      connection(esStore,   ["mutable://lw/*/traces/**", "mutable://lw/*/threads/**"]),
      connection(blobStore, ["hash://lw/**"]),
      connection(pgStore,   ["mutable://lw/*/prompts/**", "mutable://lw/*/annotations/**"]),
    ],
    read:    [/* same partition */],
    observe: [connection(esStore, ["mutable://lw/**"])],
  },

  // 2. Classify the incoming trace by uri prefix.
  programs: {
    "mutable://lw": traceIngestProgram, // → "lw:trace.ok" | "lw:trace.invalid_schema"
  },

  // 3. Decompose: split the composite trace into addressable Outputs and
  //    compute rollups — exactly the "decompose" handler shape from types.ts.
  handlers: {
    "lw:trace.ok": async (out) => {
      const [uri, trace] = out;
      const base = uri.slice(0, uri.lastIndexOf("/traces/"));
      const metrics = rollup(trace.spans);            // cost/tokens/latency
      return [
        [uri, { ...trace, metrics, spans: undefined }],         // trace doc
        ...trace.spans.map((s) => [`${uri}/spans/${s.span_id}`, s]),
        ...(trace.events ?? []).map((e) => [`${uri}/events/${e.event_id}`, e]),
        [`${base}/threads/${trace.metadata.thread_id}/traces/${trace.trace_id}`,
          { trace_id: trace.trace_id, started_at: trace.timestamps.started_at }],
      ];
    },
    "lw:trace.invalid_schema": async () => [], // refuse — drop malformed
  },

  // 4. Downstream async work — what Redis queues do in LangWatch.
  reactions: {
    "mutable://lw/*/traces/*": async ([uri, trace]) => {
      // schedule guardrails/evals: write them in "scheduled" state; an
      // async worker reads, evaluates, and writes back "processed".
      for (const ev of plannedEvaluators(trace)) {
        await rig.receive([[
          `${uri}/evaluations/${ev.id}`,
          { status: "scheduled", evaluator_id: ev.id, /* … */ },
        ]]);
      }
    },
  },

  // 5. Auth + tenant scoping replaces API keys.
  hooks: {
    beforeReceive: (ctx) => { /* verify Identity signature; assert uri's
                                 <project> matches the signer's scope */ },
  },
});
```

The evaluation worker closes the loop with the same primitives:

```ts
for await (const uris of rig.observe(["mutable://lw/*/traces/*/evaluations/*"], sig)) {
  for (const u of uris) {
    const [[, ev]] = await rig.read([u]);
    if (ev.status !== "scheduled") continue;
    const result = await runEvaluator(ev);           // call judge/guardrail
    await rig.receive([[u, { ...ev, ...result, status: "processed" }]]);
  }
}
```

And the dashboard's live feed is just an observe subscription — no change-polling
against ES:

```ts
for await (const uris of rig.observe(["mutable://lw/acme/traces/**"], sig)) {
  const outs = await rig.read(uris);
  ui.upsert(outs);
}
```

---

## 5. Payloads, typed values, and validation

b3nd treats payloads as opaque, so LangWatch's `SpanInputOutput` typed-value
union, `ChatMessage`, `RAGChunk`, `Evaluation`, etc. are **kept exactly as the
payload schema** — no translation. The shape tag (`{ type: "chat_messages",
value: […] }`) is self-describing, which suits b3nd's "the client owns content
shape" stance.

Schema validation that LangWatch does at the collector (zod) becomes a
**Program** concern: `traceIngestProgram` returns `lw:trace.invalid_schema` and
the handler refuses (`return []`). This keeps validation at the edge and the
framework mechanistic.

Trace-level `metrics` rollups are derived, not transported — compute them in the
decompose handler (§4 step 3) so the stored trace doc carries them, mirroring
LangWatch computing metrics during ingestion.

---

## 6. What fits, what doesn't, and the bonus

**Fits cleanly**

- The trace/thread/span/event hierarchy → a uri tree.
- Ingest → decompose → enqueue → async-result → live-update → the
  receive/program/handler/reaction/observe pipeline. This is the heart of
  LangWatch and it maps essentially 1:1.
- Polyglot storage → Rig routing one uri space across ES + blob + Postgres
  clients, composed exactly as `docs/backends.md` describes.
- Versioned datasets/prompts → `hash://` content addressing (dedup + integrity).
- Auth/multitenancy → Identity signatures + a `beforeReceive` scoping hook.

**Doesn't fit naturally (don't force it)**

- **Rich analytics/OLAP.** b3nd is an addressing/routing/replication layer, not a
  query engine. Aggregations (p95 latency, cost-over-time, group-by-model) and
  full-text search must live *inside* the backing store and be surfaced through
  `x-*` functions. b3nd gives you `read/ls/count`; everything richer is a
  provider extension, not a framework capability.
- **Relational/transactional data** (projects ↔ users ↔ API keys, billing,
  RBAC). Joins and multi-row transactions don't reduce to uri-KV. Keep these in a
  Postgres-backed client behind a `mutable://lw/admin/**` route, or outside b3nd
  entirely. b3nd shines for the *event-sourced telemetry* half, not the
  control-plane half.
- **No built-in schema enforcement** — you reintroduce it via Programs, which is
  a feature (validation is explicit and per-prefix) but is work you'd otherwise
  get from zod-at-the-edge + ES mappings.

**The bonus b3nd brings that LangWatch doesn't have**

Decentralized replication. Because writes flow through the Rig, a trace can be
replicated across nodes with b3nd's `network()` policies (flood / path-vector /
tell-and-read). That enables edge/on-prem collectors that buffer locally and
sync to a hub, region-local trace storage with cross-region fan-out, or
offline-first SDKs — topologies a single centralized Elasticsearch cluster
doesn't offer natively. The same `[uri, payload]` write is the unit of both
storage and replication.

---

## 7. Summary

LangWatch is, structurally, an event-sourced system wearing an Elasticsearch
coat: append a composite trace, decompose it, roll up metrics, trigger async
evaluation, stream changes to a UI. Every one of those verbs has a direct b3nd
primitive — `receive`, handler-decompose, reaction, `observe` — and its polyglot
storage is just Rig routing over one uri namespace. The clean port is the
**telemetry plane** (traces/spans/evals/events as a `mutable://lw/**` tree plus
`hash://` for versioned datasets/prompts). The parts to leave in a conventional
database are the **analytics/OLAP** queries (expose via `x-*` fns) and the
**relational control plane** (projects/users/keys). In exchange, b3nd adds
decentralized replication that the upstream centralized design can't do.
