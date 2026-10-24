# Phase 0 validation evidence

Executed locally on 24 October 2026 using `python scripts/validate_phase0.py`.

Result: **PASS — 1854 structural/example/coverage checks.**

## Artifact counts

| Artifact | Count |
|---|---|
| frontend routes | 90 |
| HTTP operations | 178 |
| critical HTTP schemas | 15 |
| broker events | 37 |
| socket events | 12 |
| critical CTAs | 19 |
| traceability rows | 53 |

## Checks executed

- Regenerated-artifact drift; unique routes/operations; Chennai fail-closed market; four protected workspaces.
- Path parameters, local schema references, owner/error/security metadata and CTA operation linkage.
- JSON Schema meta-validation; payment-event positive/negative examples; secret/producer/version/time rejection.
- Money/quote/version/proof constraints; socket direction and coordinate bounds.
- Numbered PRD and Phase 0 acceptance coverage; trace links; local document links.
- Declared token text contrast pairs (ratios below).

| Foreground | Background | Ratio |
|---|---|---|
| text | surface | 14.68:1 |
| text-muted | surface | 7.56:1 |
| text | canvas | 14.15:1 |
| on-primary | primary | 5.77:1 |
| on-primary | primary-hover | 7.94:1 |
| success | success-surface | 6.81:1 |
| warning | warning-surface | 6.62:1 |
| danger | danger-surface | 5.91:1 |
| info | info-surface | 8.01:1 |

## Not tested / not claimed

No app/server exists yet. No full OpenAPI conformance validator was available; structural checks and embedded JSON Schema checks are not a replacement for one. No runtime role authorization, E2E navigation, actual browser UI, external provider call, live payment, cloud deployment, TLS handshake, HA, load test or user design approval was performed. Those remain implementation/staging gates. All HTTP operations remain excluded from production client generation.
