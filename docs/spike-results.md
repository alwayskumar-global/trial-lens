# Spike results

Append-only log written by `eval/spike/*` scripts. No secrets, no response bodies.

## 2026-10-05T14:05:01.827Z — 01-smoke (Token Factory)

- Node v22.22.0; base URL: `https://api.tokenfactory.nebius.com/v1/`

### a. Network (unauthenticated GET)

| Host | Result | Detail |
|---|---|---|
| api.tokenfactory.nebius.com | reachable | HTTP 404 |
| clinicaltrials.gov | reachable | HTTP 200 |

### b. Models list

- OpenAI SDK `models.list()`: OK, 25 models total
- Nemotron IDs (4):
  - `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`
  - `nvidia/Nemotron-3-Ultra-550b-a55b`
  - `nvidia/Nemotron-3_5-Lightning`
  - `nvidia/nemotron-3-super-120b-a12b`

### c. Chat completion ("Reply with the single word: ok", temperature 0, max_tokens 32)

Skipped: `NEMOTRON_MODEL_FAST|MID|DEEP` not set. Candidates listed in (b).
