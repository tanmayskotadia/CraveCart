"""Validate Discovery artifacts. Requires the existing jsonschema Python package."""
from pathlib import Path
from copy import deepcopy
import csv
import json
import re
import sys

try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError:
    raise SystemExit("Missing dependency: jsonschema. Install into your chosen development Python environment before validation.")

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / "contracts"
CHECKS = []


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    CHECKS.append(message)


def read(name):
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def walk(value):
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def valid(validator, value):
    return not list(validator.iter_errors(value))


def local_refs(document):
    for node in walk(document):
        if not isinstance(node, dict) or "$ref" not in node:
            continue
        ref = node["$ref"]
        check(ref.startswith("#/"), f"No remote reference required: {ref}")
        target = document
        for part in ref[2:].split("/"):
            target = target[part.replace("~1", "/").replace("~0", "~")]


def main():
    import build_contracts as builder
    routes, api, events, sockets, actions = [read(name) for name in ["routes.json", "openapi.json", "events.schema.json", "socket.schema.json", "actions.json"]]
    check(routes == builder.build_routes(), "Route manifest matches source baseline")
    check(api == builder.build_openapi(builder.inventory()), "HTTP inventory matches source baseline")
    check(events == builder.build_events(), "Broker schemas match source baseline")
    check(sockets == builder.build_sockets(), "Socket schemas match source baseline")
    check(actions == builder.build_actions(), "CTA mappings match source baseline")
    route_paths = [r["path"] for r in routes["routes"]]
    route_ids = [r["id"] for r in routes["routes"]]
    check(len(set(route_paths)) == len(route_paths), "No duplicate frontend paths")
    check(len(set(route_ids)) == len(route_ids), "No duplicate frontend route IDs")
    check(routes["market"]["scope"] == "national" and routes["market"]["country"] == "IN" and not routes["market"]["liveZonesEnabled"], "National discovery market fails closed without approved local zones")
    check("*" in route_paths and "/403" in route_paths, "404 and forbidden routes declared")
    for role in ["customer", "seller", "rider", "admin"]:
        check(any(r["workspace"] == role and r["sessionRequired"] for r in routes["routes"]), f"Protected {role} workspace declared")
    check(all(not r["implemented"] for r in routes["routes"]), "Route implementation status is truthful")
    for route in routes["routes"]:
        check("error" in route["states"], f"Route has error state: {route['path']}")
    check(api["openapi"] == "3.1.0" and api["servers"][0]["url"] == "/api/v1", "OpenAPI version and gateway base declared")
    operations = {}
    for path, methods in api["paths"].items():
        check(path.startswith("/") and "?" not in path and ":" not in path, f"Normalized API path: {path}")
        for method, operation in methods.items():
            oid = operation["operationId"]
            check(oid not in operations, f"Unique operation ID: {oid}")
            operations[oid] = operation
            check(method in ["get", "post", "put", "patch", "delete"], f"Valid method: {oid}")
            declared = {p["name"] for p in operation.get("parameters", []) if p["in"] == "path" and p.get("required")}
            check(declared == set(re.findall(r"{([^}]+)}", path)), f"All path parameters required: {oid}")
            check("default" in operation["responses"] and "security" in operation, f"Errors and security declared: {oid}")
            check(operation["x-owner"] in builder.SERVICES.values(), f"Known owner: {oid}")
            check(operation["x-client-generation-ready"] == (path == "/platform" or method in read("identity.openapi.json").get(path, {})) and (not operation["x-client-generation-ready"] or operation["x-contract-status"] == "implementation-ready"), f"Client generation limited to implemented slice: {oid}")
    local_refs(api)
    for action in actions["actions"]:
        check(bool(action["success"] and action["recovery"]), f"CTA success/recovery: {action['label']}")
        for operation in action["operations"]:
            check(operation["method"] in api["paths"].get(operation["path"], {}), f"CTA resolves: {action['label']} -> {operation['path']}")
    # Validate embedded API schemas as JSON Schema with local component references.
    defs = json.loads(json.dumps(api["components"]["schemas"]).replace("#/components/schemas/", "#/$defs/"))
    for name, schema in defs.items():
        Draft202012Validator.check_schema(schema)
    def schema_validator(name):
        return Draft202012Validator({"$schema": "https://json-schema.org/draft/2020-12/schema", "$defs": defs, "$ref": f"#/$defs/{name}"}, format_checker=FormatChecker())
    check(valid(schema_validator("QuoteRequest"), {"addressId": "address_001", "tipMinor": 100}), "Quote request accepts valid own-address reference")
    check(not valid(schema_validator("QuoteRequest"), {"addressId": "address_001", "totalMinor": 1}), "Quote request rejects client-supplied total")
    check(not valid(schema_validator("Money"), {"amountMinor": 10.5, "currency": "INR"}), "Money rejects fractional minor units")
    check(not valid(schema_validator("Money"), {"amountMinor": -1, "currency": "INR"}), "Money rejects negative amount")
    check(not valid(schema_validator("CancelOrderRequest"), {"reason": "cancel"}), "Cancellation requires expected version")
    check(not valid(schema_validator("ProofRequest"), {"expectedVersion": 1, "otp": "12"}), "Completion proof rejects malformed OTP")
    for schema, label in [(events, "broker"), (sockets, "socket")]:
        Draft202012Validator.check_schema(schema)
        check(len(schema["oneOf"]) == len({v["title"] for v in schema["oneOf"]}), f"Unique {label} event discriminators")
    broker_validator = Draft202012Validator(events, format_checker=FormatChecker())
    sample = {"eventId": "5deebfc7-3fb4-48ec-91be-4139c3218c44", "eventType": "payment.captured.v1", "schemaVersion": 1,
              "occurredAt": "2026-10-24T10:00:00Z", "producer": "utils",
              "aggregate": {"type": "payment", "id": "payment_001", "version": 1}, "correlationId": "correlation_001", "causationId": "command_001",
              "data": {"orderId": "order_001", "attemptId": "attempt_001", "gateway": "razorpay", "providerPaymentId": "pay_test001", "amountMinor": 12900, "currency": "INR"}}
    check(valid(broker_validator, sample), "Valid captured-payment event accepted")
    for label, mutate in [
        ("wrong producer", lambda x: x.update(producer="rider")),
        ("unknown schema version", lambda x: x.update(schemaVersion=2)),
        ("missing provider reference", lambda x: x["data"].pop("providerPaymentId")),
        ("secret payload", lambda x: x["data"].update(otp="123456")),
        ("bad timestamp", lambda x: x.update(occurredAt="yesterday")),
    ]:
        altered = deepcopy(sample)
        mutate(altered)
        check(not valid(broker_validator, altered), f"Broker schema rejects {label}")
    event_rows = "\n".join(line for line in builder.TEXT.split("## 6.", 1)[1].split("## 7.", 1)[0].splitlines() if line.startswith("| `"))
    documented_events = set(re.findall(r"`([a-z]+\.[a-z-]+\.v1)`", event_rows))
    check(documented_events <= {v["title"] for v in events["oneOf"]}, "All documented domain events have payload schemas")
    documented_sockets = set(re.findall(r"\| `(\w+[.][\w.\-]+)` \|", builder.TEXT.split("## 7.", 1)[1]))
    check(documented_sockets == {v["title"] for v in sockets["oneOf"]}, "All documented socket events have payload schemas")
    socket_validator = Draft202012Validator(sockets, format_checker=FormatChecker())
    location = {"event": "rider.location.update", "direction": "client-to-server", "data": {"deliveryId": "delivery_001", "lat": 13.0827, "lng": 80.2707, "accuracy": 10, "capturedAt": "2026-10-24T10:00:00Z", "sequence": 1}}
    check(valid(socket_validator, location), "Valid Chennai location sample accepted")
    invalid = deepcopy(location)
    invalid["data"]["lat"] = 91
    check(not valid(socket_validator, invalid), "Invalid latitude rejected")
    invalid = deepcopy(location)
    invalid["direction"] = "server-to-client"
    check(not valid(socket_validator, invalid), "Incorrect socket event direction rejected")
    check(all(v["x-authorization"] for v in sockets["oneOf"]), "Socket authorization intent declared")
    with (ROOT / "docs/discovery/traceability.csv").open(encoding="utf-8", newline="") as file:
        trace = list(csv.DictReader(file))
    check(len(trace) == len({r["requirement_id"] for r in trace}), "Unique acceptance/requirement IDs")
    for row in trace:
        if row["route"]:
            check(row["route"] in route_paths, f"Trace route resolves: {row['requirement_id']}")
            check(api["paths"][row["api_path"]][row["method"].lower()]["operationId"] == row["operation_id"], f"Trace operation resolves: {row['requirement_id']}")
    declared_ids = set()
    for name in ["DISCOVERY.md", "JOURNEYS.md", "DESIGN-SYSTEM.md"]:
        declared_ids.update(re.findall(r"P0-[A-Z]+-\d{2}", (ROOT / "docs/discovery" / name).read_text(encoding="utf-8")))
    check(declared_ids <= {r["requirement_id"] for r in trace}, "Every declared Discovery acceptance ID is traced")
    prd = (ROOT / "docs/PRD.md").read_text(encoding="utf-8")
    prd_ids = set(re.findall(r"\b[CSRA]-\d{2}\b", prd))
    check(prd_ids <= {r["requirement_id"] for r in trace}, "Every numbered PRD feature family is traced")
    broken = []
    for folder in [ROOT / "docs", CONTRACTS]:
        for file in folder.rglob("*.md"):
            for target in re.findall(r"\]\(([^)]+)\)", file.read_text(encoding="utf-8")):
                if re.match(r"^[a-z]+:", target) or target.startswith("#"):
                    continue
                if not (file.parent / target.split("#", 1)[0]).resolve().exists():
                    broken.append(f"{file.relative_to(ROOT)} -> {target}")
    check(not broken, f"All local Markdown links resolve: {broken}")
    css = (ROOT / "design/tokens.css").read_text(encoding="utf-8")
    colors = dict(re.findall(r"--cc-([a-z-]+):\s*(#[0-9a-fA-F]{6})", css))
    def luminance(hexcolor):
        values = [int(hexcolor[i:i+2], 16) / 255 for i in [1, 3, 5]]
        linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values]
        return sum(v * k for v, k in zip(linear, [0.2126, 0.7152, 0.0722]))
    contrasts = []
    for foreground, background in [("text", "surface"), ("text-muted", "surface"), ("text", "canvas"), ("on-primary", "primary"), ("on-primary", "primary-hover"), ("success", "success-surface"), ("warning", "warning-surface"), ("danger", "danger-surface"), ("info", "info-surface")]:
        values = sorted([luminance(colors[foreground]), luminance(colors[background])])
        ratio = (values[1] + 0.05) / (values[0] + 0.05)
        check(ratio >= 4.5, f"Text contrast {foreground}/{background}: {ratio:.2f}:1")
        contrasts.append((foreground, background, ratio))
    counts = {"frontend routes": len(route_paths), "HTTP operations": len(operations), "critical HTTP schemas": sum(o["x-contract-status"] == "critical-baseline" for o in operations.values()),
              "broker events": len(events["oneOf"]), "socket events": len(sockets["oneOf"]), "critical CTAs": len(actions["actions"]), "traceability rows": len(trace)}
    report = ["# Discovery validation evidence", "", "Executed locally on 24 October 2026 using `python scripts/validate_contracts.py`.", "", f"Result: **PASS — {len(CHECKS)} structural/example/coverage checks.**", "", "## Artifact counts", "", "| Artifact | Count |", "|---|---|"]
    report.extend(f"| {name} | {value} |" for name, value in counts.items())
    report += ["", "## Checks executed", "", "- Regenerated-artifact drift; unique routes/operations; National market with fail-closed local zones; four protected workspaces.", "- Path parameters, local schema references, owner/error/security metadata and CTA operation linkage.", "- JSON Schema meta-validation; payment-event positive/negative examples; secret/producer/version/time rejection.", "- Money/quote/version/proof constraints; socket direction and coordinate bounds.", "- Numbered PRD and Discovery acceptance coverage; trace links; local document links.", "- Declared token text contrast pairs (ratios below).", "", "| Foreground | Background | Ratio |", "|---|---|---|"]
    report.extend(f"| {fg} | {bg} | {ratio:.2f}:1 |" for fg, bg, ratio in contrasts)
    report += ["", "## Scope", "", "These checks validate planning and contract artifacts only. Runtime foundation verification is recorded separately in docs/engineering/VERIFICATION.md. GET /platform and the exported identity/onboarding operations are implementation-ready; remaining contracts retain their declared baseline status. This script does not execute browser, cloud, payment, load or deployed network tests, and is not a full OpenAPI conformance validator.", ""]
    (ROOT / "docs/discovery/VALIDATION.md").write_text("\n".join(report), encoding="utf-8")
    print(f"PASS: {len(CHECKS)} checks")
    for name, value in counts.items():
        print(f"  {name}: {value}")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, KeyError, ValueError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
