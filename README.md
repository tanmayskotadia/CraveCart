# CraveCart

MERN food-delivery marketplace for Chennai, with customer, seller, rider and admin workspaces, six backend services, RabbitMQ, realtime tracking, payments and a grounded assistant.

**Current stage:** Phase 0 discovery and contract baseline. Application scaffolding is Phase 1; there is no running marketplace yet.

- [Planning pack](docs/README.md)
- [Phase 0 deliverables and readiness](docs/phase-0/README.md)
- [Product requirements](docs/PRD.md)
- [Implementation roadmap](docs/IMPLEMENTATION-PLAN.md)

Validate the local Phase 0 artifacts with Python 3.12+ and `jsonschema` available. The tested validator dependency is recorded in `scripts/requirements-phase0.txt`:

```powershell
python scripts/validate_phase0.py
```

Regenerate the machine-readable baseline after editing the planning route inventory or generator:

```powershell
python scripts/build_phase0_contracts.py
python scripts/validate_phase0.py
```

Contract lifecycle and incomplete endpoint schemas are explicitly documented in [contracts/README.md](contracts/README.md).
