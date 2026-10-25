# Discovery validation evidence

Executed locally on 26 October 2026 using `python scripts/validate_contracts.py`.

Result: **PASS — 2466 structural/example/coverage checks.**

## Artifact counts

| Artifact | Count |
|---|---|
| frontend routes | 95 |
| HTTP operations | 258 |
| critical HTTP schemas | 2 |
| broker events | 38 |
| socket events | 15 |
| critical CTAs | 19 |
| traceability rows | 53 |

## Checks executed

- Regenerated-artifact drift; unique routes/operations; National market with fail-closed local zones; four protected workspaces.
- Path parameters, local schema references, owner/error/security metadata and CTA operation linkage.
- JSON Schema meta-validation; payment-event positive/negative examples; secret/producer/version/time rejection.
- Money/quote/version/proof constraints; socket direction and coordinate bounds.
- Numbered PRD and Discovery acceptance coverage; trace links; local document links.
- Declared token text contrast pairs (ratios below).

| Foreground | Background | Ratio |
|---|---|---|
| text | surface | 16.08:1 |
| text-muted | surface | 7.56:1 |
| text | canvas | 16.08:1 |
| on-primary | primary | 4.80:1 |
| on-primary | primary-hover | 6.13:1 |
| success | success-surface | 6.81:1 |
| warning | warning-surface | 6.62:1 |
| danger | danger-surface | 5.91:1 |
| info | info-surface | 8.01:1 |

## Scope

These checks validate planning and contract artifacts only. Runtime foundation verification is recorded separately in docs/engineering/VERIFICATION.md. GET /platform and the exported identity/onboarding, catalog/cart and checkout/payment operations are implementation-ready; remaining contracts retain their declared baseline status. This script does not execute browser, cloud, payment, load or deployed network tests, and is not a full OpenAPI conformance validator.
