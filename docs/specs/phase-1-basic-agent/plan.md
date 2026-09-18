# Phase 1 Plan: Basic PR Review Agent

## Proposed Data Flow

```text
Review form
  -> POST /api/review
  -> Zod input validation
  -> review prompt builder
  -> mock stream OR prReviewAgent.stream(...)
  -> NDJSON events: meta / progress / text / result / error
  -> browser incremental rendering
  -> Zod-validated structured result display
```

## Module Boundaries

- `src/domain/review/`: request, result, event schemas, prompt construction, and mock stream.
- `src/mastra/agents/`: Agent configuration only.
- `app/api/review/route.ts`: HTTP parsing, validation, timeout, and transport.
- `app/components/`: client form and stream state.
- `tests/`: schema, prompt, mock transport, and rendering-adjacent checks.

## Key Decisions

### Use a server route as the first boundary

This keeps provider credentials and Agent execution on the server while keeping the browser contract easy to inspect.

### Use NDJSON as the first transport

The route emits newline-delimited JSON events. This adds a small protocol, but avoids mixing partial display text with the final review object. It gives the browser explicit `progress`, `text`, `result`, and `error` states while retaining a simple Web Streams implementation.

### Add mock mode before provider integration

The project proves UI states and request validation without requiring a paid model call. The server selects mock mode when `REVIEW_MODE=mock` or `OPENAI_API_KEY` is absent. Mock output is deterministic and deliberately labels itself as non-judgmental.

### Validate with Zod at the boundary

The HTTP boundary should reject malformed input before constructing a prompt or spending tokens.

### Generate the final result with Mastra structured output

The real-model path uses `prReviewAgent.stream()` with Mastra's `structuredOutput` schema. Raw text is forwarded as `text` events, while the final result is only emitted after it has been parsed against `ReviewResultSchema`. The UI never parses Markdown headings to reconstruct review data.

## Risks

- Model output may not match the structured schema.
- A large diff can increase latency and cost.
- Streaming partial text can leave the UI in an ambiguous state.
- Untrusted diff content may attempt prompt injection.

## Implemented Mitigations

- Strict Zod schemas reject missing, unknown, or oversized fields before agent invocation.
- The prompt wraps user focus and diff in explicit untrusted-content delimiters.
- A 30-second server-side timeout and client-side cancellation signal stop stalled requests.
- The response sets `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `X-Accel-Buffering: no`.
- Error events use safe public messages; full submitted diffs are not logged.

Mitigations will be implemented as explicit tasks rather than hidden in the prompt.
