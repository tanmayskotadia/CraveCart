"""Build the Phase 0 contract baseline from the reviewed planning inventory.

Standard library only. Run from any directory; paths resolve relative to this file.
Do not use inventory-only operations to generate production clients.
"""
from pathlib import Path
import csv
import json
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/ROUTES-AND-CONTRACTS.md"
OUT = ROOT / "contracts"
TEXT = SOURCE.read_text(encoding="utf-8")
SERVICES = {"Auth": "auth", "Restaurant": "restaurant", "Rider": "rider",
            "Admin": "admin", "Realtime": "realtime", "Utils": "utils"}


def write_json(name, value):
    OUT.mkdir(exist_ok=True)
    (OUT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def obj(properties, required=None):
    return {"type": "object", "properties": properties,
            "required": list(properties) if required is None else required, "additionalProperties": False}


def string(**extra):
    return {"type": "string", **extra}


ID = string(minLength=6, maxLength=128, pattern=r"^[A-Za-z0-9_-]+$")
TIME = string(format="date-time")
INT = {"type": "integer", "minimum": 0}
VERSION = {"type": "integer", "minimum": 1}
REASON = string(minLength=1, maxLength=1000)
ORDER_STATES = ["PAYMENT_PENDING", "PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP",
                "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED", "REJECTED", "CANCELLED", "EXPIRED", "DELIVERY_FAILED"]


def ref(name):
    return {"$ref": f"#/components/schemas/{name}"}


def envelope(schema):
    return obj({"data": schema, "meta": obj({"requestId": ID, "nextCursor": string(maxLength=512)}, ["requestId"])}, ["data"])


def build_routes():
    block = TEXT.split("## 2. Frontend pages", 1)[1].split("## 3.", 1)[0]
    routes = []
    workspace = "public"
    for line in block.splitlines():
        if line.startswith("### "):
            title = line[4:]
            workspace = next((role for role in ["customer", "seller", "rider", "admin"] if title.lower().startswith(role)), "public")
        if not line.startswith("| `"):
            continue
        cols = [v.strip() for v in line.strip("|").split("|")]
        match = re.fullmatch(r"`([^`]+)`", cols[0])
        if not match:
            continue
        path = match[1]
        access = cols[1] if len(cols) == 3 else workspace
        roles = [workspace] if workspace != "public" else []
        auth = workspace != "public"
        if workspace == "public" and access in ["Authenticated", "Pending auth challenge", "Admin identity", "Valid recovery flow", "Applicant"]:
            auth = access == "Authenticated"
        if path in ["/cart"]:
            auth, roles = False, []
            access = "Guest cart or authenticated own cart"
        if path == "/workspaces":
            roles = ["customer", "seller", "rider", "admin"]
        routes.append({"id": "page_" + ("not_found" if path == "*" else re.sub(r"[^a-zA-Z0-9]+", "_", path).strip("_") or "home"),
                       "path": path, "workspace": workspace, "sessionRequired": auth, "roles": roles,
                       "policy": access, "purpose": cols[-1],
                       "states": ["loading", "empty", "ready", "validation-error", "forbidden", "not-found", "offline", "error"],
                       "implemented": False})
    for path in ["/notifications", "/settings", "/settings/sessions", "/settings/privacy", "/support", "/support/tickets/:ticketId", "/assistant"]:
        routes.append({"id": "page_" + path.replace(":", "").strip("/").replace("/", "_"),
                       "path": path, "workspace": "active", "sessionRequired": True,
                       "roles": ["customer", "seller", "rider", "admin"], "policy": "Own data in granted active workspace",
                       "purpose": "Shared workspace feature", "states": ["loading", "empty", "ready", "forbidden", "offline", "error"], "implemented": False})
    routes.append({"id": "page_seller", "path": "/seller", "workspace": "seller", "sessionRequired": True,
                   "roles": ["seller"], "policy": "Granted seller role; onboarding allowed before verification",
                   "purpose": "Redirect by onboarding state and selected restaurant", "states": ["loading", "forbidden", "error"], "implemented": False})
    return {"version": "0.1.0", "status": "design-baseline", "market": {"city": "Chennai", "country": "IN", "currency": "INR", "locale": "en-IN", "timezone": "Asia/Kolkata", "liveZonesEnabled": False},
            "routes": routes, "aliases": [{"from": "/driver/*", "to": "/rider/*", "strategy": "validated-equivalent-only", "unknownSuffix": "404"}]}


def inventory():
    block = TEXT.split("## 5. HTTP API inventory", 1)[1].split("## 6.", 1)[0]
    owner = None
    endpoints = []
    for line in block.splitlines():
        if line.startswith("### "):
            owner = next((v for k, v in SERVICES.items() if line[4:].startswith(k)), None)
        if not re.match(r"^\| (GET|POST|PUT|PATCH|DELETE)", line):
            continue
        cols = [v.strip() for v in line.strip("|").split("|")]
        for method in cols[0].split(", "):
            for path in re.findall(r"`([^`]+)`", cols[1]):
                endpoints.append({"method": method.lower(), "path": path, "owner": owner, "policy": cols[2]})
    return endpoints


def build_openapi(endpoints):
    schemas = {
        "Error": obj({"error": obj({"code": string(minLength=1), "message": string(minLength=1),
                                     "requestId": ID, "retryable": {"type": "boolean"},
                                     "fields": {"type": "object", "additionalProperties": string()}}, ["code", "message", "requestId", "retryable"])}),
        "InventoryResponse": {"type": "object", "required": ["data"], "properties": {"data": {}, "meta": {"type": "object"}}, "description": "Inventory placeholder, not an implementation-ready response schema."},
        "Money": obj({"amountMinor": INT, "currency": string(pattern="^[A-Z]{3}$")}),
        "QuoteRequest": obj({"addressId": ID, "couponCode": string(minLength=1, maxLength=64), "tipMinor": INT}, ["addressId"]),
        "Quote": obj({"quoteId": ID, "restaurantId": ID, "addressId": ID, "expiresAt": TIME,
                      "policyVersion": ID, "currency": string(enum=["INR"]),
                      "subtotalMinor": INT, "discountMinor": INT, "deliveryFeeMinor": INT,
                      "platformFeeMinor": INT, "taxMinor": INT, "tipMinor": INT, "totalMinor": INT}),
        "CreateOrderRequest": obj({"quoteId": ID, "policyVersion": ID}),
        "OrderSummary": obj({"orderId": ID, "status": string(enum=ORDER_STATES), "version": VERSION,
                             "total": ref("Money"), "paymentState": string(enum=["CREATED", "PENDING", "CAPTURED", "FAILED", "EXPIRED", "PARTIALLY_REFUNDED", "REFUNDED"])}),
        "VersionCommand": obj({"expectedVersion": VERSION}),
        "CancelOrderRequest": obj({"expectedVersion": VERSION, "reason": REASON}),
        "PaymentAttemptRequest": obj({"orderId": ID, "gateway": string(enum=["razorpay", "stripe"])}),
        "PaymentAttempt": obj({"attemptId": ID, "orderId": ID, "gateway": string(enum=["razorpay", "stripe"]),
                               "state": string(enum=["CREATED", "PENDING", "CAPTURED", "FAILED", "EXPIRED"]),
                               "amount": ref("Money")}),
        "PaymentInitiation": obj({"attempt": ref("PaymentAttempt"), "checkout": {"oneOf": [
            obj({"gateway": {"const": "razorpay"}, "publicKeyId": string(minLength=1), "providerOrderId": string(minLength=1)}),
            obj({"gateway": {"const": "stripe"}, "checkoutUrl": string(format="uri")})]}}),
        "RazorpayProof": obj({"gateway": {"const": "razorpay"}, "providerOrderId": string(minLength=1), "providerPaymentId": string(minLength=1), "signature": string(minLength=1)}),
        "StripeProof": obj({"gateway": {"const": "stripe"}, "checkoutSessionId": string(minLength=1)}),
        "SellerAction": obj({"expectedVersion": VERSION, "action": string(enum=["accept", "reject", "preparing", "ready"]),
                             "reason": REASON, "preparationMinutes": {"type": "integer", "minimum": 1, "maximum": 180}}, ["expectedVersion", "action"]),
        "OfferAccept": obj({"expectedVersion": VERSION}),
        "DeliveryOperation": obj({"operationId": ID, "deliveryId": ID, "state": string(enum=["PENDING", "APPLIED", "REJECTED"])}),
        "ProofRequest": obj({"expectedVersion": VERSION, "otp": string(pattern="^[0-9]{6}$")}),
        "Location": obj({"deliveryId": ID, "lat": {"type": "number", "minimum": -90, "maximum": 90},
                         "lng": {"type": "number", "minimum": -180, "maximum": 180},
                         "accuracy": {"type": "number", "minimum": 0}, "capturedAt": TIME, "sequence": INT}),
        "AvailabilityRequest": obj({"online": {"type": "boolean"}}),
        "Operation": obj({"operationId": ID, "state": string(enum=["PENDING", "APPLIED", "REJECTED", "FAILED"])}),
        "RefundApproval": obj({"expectedVersion": VERSION, "reason": REASON}),
        "AssistantConfirmation": obj({"confirmationToken": string(minLength=32, maxLength=2048)}),
    }
    details = {
        ("post", "/cart/quote"): ("QuoteRequest", "Quote", "200"),
        ("post", "/orders"): ("CreateOrderRequest", "OrderSummary", "201"),
        ("get", "/orders/:orderId"): (None, "OrderSummary", "200"),
        ("post", "/orders/:orderId/cancel"): ("CancelOrderRequest", "OrderSummary", "200"),
        ("post", "/payments/attempts"): ("PaymentAttemptRequest", "PaymentInitiation", "201"),
        ("get", "/payments/attempts/:attemptId"): (None, "PaymentAttempt", "200"),
        ("post", "/seller/restaurants/:restaurantId/orders/:orderId/actions"): ("SellerAction", "OrderSummary", "200"),
        ("post", "/rider/offers/:offerId/accept"): ("OfferAccept", "DeliveryOperation", "202"),
        ("post", "/rider/deliveries/:deliveryId/pickup"): ("ProofRequest", "DeliveryOperation", "202"),
        ("post", "/rider/deliveries/:deliveryId/complete"): ("ProofRequest", "DeliveryOperation", "202"),
        ("post", "/rider/location"): ("Location", None, "204"),
        ("post", "/admin/refunds/:refundId/approve"): ("RefundApproval", "Operation", "202"),
        ("post", "/admin/refunds/:refundId/execute"): ("RefundApproval", "Operation", "202"),
        ("get", "/admin/operations/:operationId"): (None, "Operation", "200"),
    }
    public = {"/auth/register", "/auth/login", "/auth/otp/request", "/auth/otp/verify", "/auth/recovery/request", "/auth/recovery/reset",
              "/serviceability", "/restaurants", "/restaurants/:restaurantId", "/restaurants/by-slug/:slug",
              "/restaurants/:restaurantId/menu", "/restaurants/:restaurantId/reviews", "/search", "/offers", "/payment-methods", "/support/faqs", "/assistant/conversations"}
    paths = {}
    for item in endpoints:
        original, method = item["path"], item["method"]
        raw = original.split("?", 1)[0]
        path = re.sub(r":([A-Za-z][A-Za-z0-9]*)", r"{\1}", raw)
        oid = item["owner"] + "_" + method + "_" + re.sub(r"[^a-zA-Z0-9]+", "_", raw).strip("_")
        op = {"operationId": oid, "tags": [item["owner"]], "summary": item["policy"],
              "x-owner": item["owner"], "x-authorization": item["policy"], "x-contract-status": "inventory-only",
              "x-client-generation-ready": False, "security": [{"accessSession": []}],
              "responses": {"200": {"description": "Planned success; exact body/status must be refined before implementation.", "content": {"application/json": {"schema": ref("InventoryResponse")}}},
                            "default": {"description": "Structured validation/authentication/business/dependency error.", "content": {"application/json": {"schema": ref("Error")}}}}}
        if raw in public:
            op["security"] = []
        if raw == "/auth/refresh":
            op["security"] = [{"refreshSession": []}]
        if raw.startswith("/assistant/conversations/"):
            op["security"] = [{"accessSession": []}, {"guestSession": []}]
            op["x-authorization"] += "; guest sessions are FAQ-only; handoff requires authenticated session"
            if raw.endswith("/handoff"):
                op["security"] = [{"accessSession": []}]
        parameters = [{"name": p, "in": "path", "required": True, "schema": ID} for p in re.findall(r"{([^}]+)}", path)]
        if "?" in original:
            query = original.split("?", 1)[1].split("=", 1)[0]
            parameters.append({"name": query, "in": "query", "required": True, "schema": ID})
        if method not in ["get"] and raw not in public and not raw.startswith("/webhooks/") and raw != "/auth/refresh":
            parameters.append({"name": "X-CSRF-Token", "in": "header", "required": True, "schema": string(minLength=32, maxLength=256)})
        detail = details.get((method, raw))
        if detail:
            body, response, status = detail
            op["x-contract-status"] = "critical-baseline"
            if method == "post":
                parameters.append({"name": "Idempotency-Key", "in": "header", "required": True, "schema": string(minLength=16, maxLength=128)})
            if body:
                op["requestBody"] = {"required": True, "content": {"application/json": {"schema": ref(body)}}}
            op["responses"].pop("200")
            op["responses"][status] = {"description": "Accepted durable workflow; not necessarily applied." if status == "202" else "Success"}
            if response:
                op["responses"][status]["content"] = {"application/json": {"schema": envelope(ref(response))}}
        if raw == "/payments/attempts/:attemptId/verify":
            op["x-contract-status"] = "critical-baseline"
            op["requestBody"] = {"required": True, "content": {"application/json": {"schema": {"oneOf": [ref("RazorpayProof"), ref("StripeProof")]}}}}
            op["responses"]["200"]["content"]["application/json"]["schema"] = envelope(ref("PaymentAttempt"))
            parameters.append({"name": "Idempotency-Key", "in": "header", "required": True, "schema": string(minLength=16, maxLength=128)})
        if raw.startswith("/webhooks/"):
            provider = raw.rsplit("/", 1)[1]
            op["security"] = []
            op["x-contract-status"] = "provider-defined"
            op["x-raw-body-required"] = True
            op["x-authorization"] = "Verify provider signature using unmodified body, merchant/reference/amount/currency, then durable inbox deduplication. Not a public unauthenticated business command."
            parameters.append({"name": "X-Razorpay-Signature" if provider == "razorpay" else "Stripe-Signature", "in": "header", "required": True, "schema": string(minLength=1)})
            op["requestBody"] = {"required": True, "content": {"application/json": {"schema": {"type": "object", "description": "Provider-owned payload; verify raw bytes before parsing."}}}}
            op["responses"]["200"] = {"description": "Verified delivery durably recorded, or duplicate already recorded; domain processing may still be pending."}
        if parameters:
            op["parameters"] = parameters
        paths.setdefault(path, {})[method] = op
    return {"openapi": "3.1.0", "info": {"title": "CraveCart API — Phase 0 baseline", "version": "0.1.0",
            "description": "Endpoint inventory plus critical schemas; not implementation-ready. x-contract-status distinguishes inventory-only, critical-baseline and provider-defined operations. All operations require promotion/review before client generation."},
            "servers": [{"url": "/api/v1", "description": "Same deployment origin through gateway; no production domain asserted"}],
            "tags": [{"name": v} for v in SERVICES.values()], "paths": paths,
            "components": {"securitySchemes": {
                "accessSession": {"type": "apiKey", "in": "cookie", "name": "__Host-cc-access"},
                "refreshSession": {"type": "apiKey", "in": "cookie", "name": "__Host-cc-refresh"},
                "guestSession": {"type": "apiKey", "in": "cookie", "name": "__Host-cc-guest"}}, "schemas": schemas}}


def build_events():
    fields = {
        "identity.roles-changed.v1": {"userId": ID, "grantVersion": VERSION},
        "identity.suspended.v1": {"userId": ID, "reason": REASON},
        "seller.application-submitted.v1": {"applicationId": ID, "userId": ID},
        "rider.application-submitted.v1": {"applicationId": ID, "riderId": ID},
        "verification.decided.v1": {"applicationId": ID, "decisionId": ID, "applicantType": string(enum=["seller", "rider"]), "decision": string(enum=["approved", "rejected", "changes-requested"]), "reason": REASON},
        "restaurant.availability-changed.v1": {"restaurantId": ID, "orderable": {"type": "boolean"}},
        "menu.updated.v1": {"restaurantId": ID, "catalogVersion": VERSION},
        "payment.captured.v1": {"orderId": ID, "attemptId": ID, "gateway": string(enum=["razorpay", "stripe"]), "providerPaymentId": string(minLength=1), "amountMinor": INT, "currency": string(pattern="^[A-Z]{3}$")},
        "payment.failed.v1": {"orderId": ID, "attemptId": ID, "failureCode": string(minLength=1)},
        "delivery.assigned.v1": {"deliveryId": ID, "orderId": ID, "riderId": ID, "assignmentVersion": VERSION},
        "delivery.arrived.v1": {"deliveryId": ID, "orderId": ID, "riderId": ID},
        "delivery.pickup-requested.v1": {"deliveryId": ID, "orderId": ID, "riderId": ID, "operationId": ID, "expectedOrderVersion": VERSION, "proofId": ID},
        "delivery.completion-requested.v1": {"deliveryId": ID, "orderId": ID, "riderId": ID, "operationId": ID, "expectedOrderVersion": VERSION, "proofId": ID},
        "delivery.incident-opened.v1": {"incidentId": ID, "deliveryId": ID, "orderId": ID, "reasonCode": string(minLength=1)},
        "delivery.failed.v1": {"incidentId": ID, "deliveryId": ID, "orderId": ID, "reasonCode": string(minLength=1)},
        "settlement.updated.v1": {"settlementId": ID, "partyId": ID, "state": string(enum=["PENDING", "SUBMITTED", "PAID", "FAILED"])},
        "support.ticket-created.v1": {"ticketId": ID, "userId": ID},
        "support.ticket-updated.v1": {"ticketId": ID, "userId": ID, "state": string(enum=["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"])},
        "notification.created.v1": {"notificationId": ID, "userId": ID, "category": string(minLength=1)},
    }
    for event in re.findall(r"`(order\.[a-z-]+\.v1)`", TEXT.split("## 6.")[1].split("## 7.")[0]):
        fields[event] = {"orderId": ID, "restaurantId": ID}
        if event in ["order.picked-up.v1", "order.out-for-delivery.v1", "order.delivered.v1"]:
            fields[event].update({"deliveryId": ID, "riderId": ID, "operationId": ID})
    for state in ["requested", "submitted", "succeeded", "failed"]:
        fields[f"refund.{state}.v1"] = {"refundId": ID, "orderId": ID, "amountMinor": INT, "currency": string(pattern="^[A-Z]{3}$")}
    fields["verification.applied.v1"] = {"applicationId": ID, "decisionId": ID, "applicantType": string(enum=["seller", "rider"])}
    fields["verification.failed.v1"] = {"applicationId": ID, "decisionId": ID, "applicantType": string(enum=["seller", "rider"]), "failureCode": string(minLength=1)}
    fields["delivery.operation-rejected.v1"] = {"deliveryId": ID, "orderId": ID, "operationId": ID, "reasonCode": string(minLength=1)}
    variants = []
    for name, data in fields.items():
        producer = ("auth" if name.startswith("identity.") else "utils" if name.startswith(("payment.", "refund.", "settlement.", "support.", "notification."))
                    else "admin" if name == "verification.decided.v1" else "rider" if name.startswith(("rider.", "delivery.")) else "restaurant")
        producer_schema = string(enum=["restaurant", "rider"]) if name in ["verification.applied.v1", "verification.failed.v1"] else {"const": producer}
        if name == "delivery.operation-rejected.v1":
            producer_schema = {"const": "restaurant"}
        variant = obj({"eventId": string(format="uuid"), "eventType": {"const": name}, "schemaVersion": {"const": 1},
                       "occurredAt": TIME, "producer": producer_schema,
                       "aggregate": obj({"type": string(minLength=1, maxLength=64), "id": ID, "version": VERSION}),
                       "correlationId": ID, "causationId": ID, "data": obj(data)})
        variant["title"] = name
        variants.append(variant)
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "urn:cravecart:domain-events:v1", "title": "CraveCart broker event baseline",
            "description": "Payloads exclude secrets/full addresses/OTP. Proof IDs refer to access-controlled short-lived server proofs. Producer identity is also checked against broker credentials, not trusted from JSON alone.", "oneOf": variants}


def build_sockets():
    payloads = {
        "order.subscribe": ("client-to-server", obj({"orderId": ID, "lastEventId": ID}, ["orderId"])),
        "order.unsubscribe": ("client-to-server", obj({"orderId": ID})),
        "rider.location.update": ("client-to-server", obj({"deliveryId": ID, "lat": {"type": "number", "minimum": -90, "maximum": 90}, "lng": {"type": "number", "minimum": -180, "maximum": 180}, "accuracy": {"type": "number", "minimum": 0}, "capturedAt": TIME, "sequence": INT})),
        "order.status.updated": ("server-to-client", obj({"eventId": ID, "orderId": ID, "version": VERSION, "status": string(enum=ORDER_STATES), "occurredAt": TIME})),
        "rider.location.updated": ("server-to-client", obj({"deliveryId": ID, "orderId": ID, "lat": {"type": "number", "minimum": -90, "maximum": 90}, "lng": {"type": "number", "minimum": -180, "maximum": 180}, "accuracy": {"type": "number", "minimum": 0}, "capturedAt": TIME, "receivedAt": TIME, "sequence": INT})),
        "delivery.offer.created": ("server-to-client", obj({"offerId": ID, "expiresAt": TIME, "pickupArea": string(minLength=1), "dropArea": string(minLength=1), "earningMinor": INT, "currency": string(pattern="^[A-Z]{3}$")})),
        "delivery.offer.withdrawn": ("server-to-client", obj({"offerId": ID, "reason": REASON})),
        "delivery.assignment.updated": ("server-to-client", obj({"deliveryId": ID, "version": VERSION, "state": string(enum=["ASSIGNED", "AT_PICKUP", "PICKED_UP", "COMPLETED", "CANCELLED", "FAILED"])})),
        "notification.created": ("server-to-client", obj({"notificationId": ID, "category": string(minLength=1), "routeId": string(minLength=1), "routeParams": {"type": "object", "additionalProperties": ID}})),
        "message.created": ("server-to-client", obj({"messageId": ID, "conversationId": ID, "sequence": VERSION, "text": string(minLength=1, maxLength=4000), "sentAt": TIME})),
        "message.read": ("client-to-server", obj({"conversationId": ID, "lastReadMessageId": ID})),
        "system.resync-required": ("server-to-client", obj({"resourceType": string(enum=["order", "delivery", "notifications", "conversation"]), "resourceId": ID, "reason": REASON})),
    }
    variants = []
    for name, (direction, data) in payloads.items():
        schema = obj({"event": {"const": name}, "direction": {"const": direction}, "data": data})
        schema["title"] = name
        schema["x-authorization"] = "Validate session and resource entitlement; never accept client-selected room names. Location requires active rider assignment."
        variants.append(schema)
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "urn:cravecart:socket-events:v1", "oneOf": variants,
            "description": "Logical event descriptors; Socket.IO sends event name separately from data. Client events use acknowledgement {ok:true,data} or {ok:false,error:{code,message,requestId,retryable}}. Business writes persist before fanout."}


def build_actions():
    block = TEXT.split("## 3. Critical button contracts", 1)[1].split("## 4.", 1)[0]
    mappings = {
        "Use my location": [("get", "/serviceability")], "Add dish": [("post", "/cart/lines")],
        "Replace cart": [("post", "/cart/replace")], "Apply offer": [("post", "/cart/quote")],
        "Place and pay": [("post", "/orders"), ("post", "/payments/attempts")],
        "Payment return": [("get", "/payments/attempts/:attemptId"), ("post", "/payments/attempts/:attemptId/verify")],
        "Cancel order": [("post", "/orders/:orderId/cancellation-preview"), ("post", "/orders/:orderId/cancel")],
        "Track order": [("get", "/orders/:orderId/tracking")], "Reorder": [("post", "/orders/:orderId/reorder")],
        "Seller accept": [("post", "/seller/restaurants/:restaurantId/orders/:orderId/actions")],
        "Seller reject": [("post", "/seller/restaurants/:restaurantId/orders/:orderId/actions")],
        "Mark ready": [("post", "/seller/restaurants/:restaurantId/orders/:orderId/actions")],
        "Rider online": [("post", "/rider/availability")], "Accept delivery": [("post", "/rider/offers/:offerId/accept")],
        "Navigate": [("get", "/rider/deliveries/:deliveryId")],
        "Confirm pickup/delivery": [("post", "/rider/deliveries/:deliveryId/pickup"), ("post", "/rider/deliveries/:deliveryId/complete")],
        "Refund approval": [("post", "/admin/refunds/:refundId/approve")],
        "Chatbot action": [("post", "/assistant/actions/:actionId/confirm")], "Logout": [("post", "/auth/logout")],
    }
    actions = []
    for line in block.splitlines():
        if not line.startswith("| "):
            continue
        cols = [v.strip() for v in line.strip("|").split("|")]
        if cols[0] not in mappings:
            continue
        actions.append({"id": "action_" + re.sub(r"[^a-z]+", "_", cols[0].lower()).strip("_"), "label": cols[0],
                        "commandOrDestination": cols[1], "success": cols[2], "recovery": cols[3],
                        "operations": [{"method": m, "path": re.sub(r":(\w+)", r"{\1}", p)} for m, p in mappings[cols[0]]], "implemented": False})
    return {"version": "0.1.0", "actions": actions}


def build_traceability(routes, api):
    # Broad feature rows plus precise acceptance criteria; all status remains design-only.
    rows = [
        ("P0-DISC-01", "Chennai fail-closed serviceability", "customer", "/location", "get", "/serviceability", "3"),
        ("P0-DISC-02", "Four granted workspaces", "all", "/workspaces", "post", "/auth/workspace", "2"),
        ("P0-CUST-01", "Verified payment, not browser assertion", "customer", "/checkout/return", "post", "/payments/attempts/{attemptId}/verify", "4"),
        ("P0-CUST-02", "Idempotent checkout", "customer", "/checkout", "post", "/orders", "4"),
        ("P0-CUST-03", "Own order authorization", "customer", "/orders/:orderId", "get", "/orders/{orderId}", "2,4"),
        ("P0-CUST-04", "Cancellation/capture compensation", "customer", "/orders/:orderId", "post", "/orders/{orderId}/cancel", "4"),
        ("P0-SELL-01", "Verified restaurant availability", "seller", "/seller/onboarding", "post", "/seller/applications", "2"),
        ("P0-SELL-02", "Membership-scoped menu editing", "seller", "/seller/restaurants/:restaurantId/menu", "post", "/seller/restaurants/{restaurantId}/menu-items", "3"),
        ("P0-SELL-03", "Rejection compensation and persistent alerts", "seller", "/seller/restaurants/:restaurantId/orders", "post", "/seller/restaurants/{restaurantId}/orders/{orderId}/actions", "5"),
        ("P0-RIDE-01", "Exclusive active assignment", "rider", "/rider/offers", "post", "/rider/offers/{offerId}/accept", "5"),
        ("P0-RIDE-02", "Authorized location ingestion", "rider", "/rider/dashboard", "post", "/rider/location", "5"),
        ("P0-RIDE-03", "Applied delivery outcome", "rider", "/rider/deliveries/:deliveryId", "post", "/rider/deliveries/{deliveryId}/complete", "5"),
        ("P0-RIDE-04", "Foreground tracking scope", "rider", "/rider/deliveries/:deliveryId/navigate", "get", "/rider/deliveries/{deliveryId}", "5"),
        ("P0-ADMIN-01", "Admin MFA/no public grant", "admin", "/admin/login", "post", "/auth/mfa/verify", "2"),
        ("P0-ADMIN-02", "Requested/applied operation status", "admin", "/admin/verifications/:applicationId", "get", "/admin/operations/{operationId}", "2,6"),
        ("P0-ADMIN-03", "Separated refund approval", "admin", "/admin/refunds/:refundId", "post", "/admin/refunds/{refundId}/approve", "4,6"),
        ("P0-AI-01", "Truthful action result", "all", "/assistant", "post", "/assistant/actions/{actionId}/confirm", "7"),
        ("P0-AI-02", "Scoped grounded tools", "all", "/assistant", "post", "/assistant/conversations/{conversationId}/messages", "7"),
        ("P0-AI-03", "Single-use bound confirmation", "all", "/assistant", "post", "/assistant/actions/{actionId}/confirm", "7"),
        ("C-01", "Identity/contact/profile/sessions", "customer", "/profile", "get", "/auth/me", "2"),
        ("C-02", "Location/search/menu", "customer", "/search", "get", "/search", "3"),
        ("C-03", "Cart/modifiers/quote", "customer", "/cart", "post", "/cart/quote", "3,4"),
        ("C-04", "Orders/refunds/reorder/reviews", "customer", "/orders", "get", "/orders", "4,6"),
        ("C-05", "Tracking and messages", "customer", "/orders/:orderId/track", "get", "/orders/{orderId}/tracking", "5"),
        ("S-01", "Seller verification", "seller", "/seller/onboarding", "post", "/seller/applications", "2"),
        ("S-02", "Restaurant hours/profile", "seller", "/seller/restaurants/:restaurantId/hours", "put", "/seller/restaurants/{restaurantId}/hours", "3"),
        ("S-03", "Menu management", "seller", "/seller/restaurants/:restaurantId/menu", "post", "/seller/restaurants/{restaurantId}/menu-items", "3"),
        ("S-04", "Fulfillment state actions", "seller", "/seller/restaurants/:restaurantId/orders", "post", "/seller/restaurants/{restaurantId}/orders/{orderId}/actions", "5"),
        ("S-05", "Staff/operations", "seller", "/seller/restaurants/:restaurantId/staff", "post", "/seller/restaurants/{restaurantId}/staff", "6"),
        ("S-06", "Seller statements", "seller", "/seller/restaurants/:restaurantId/finance", "get", "/seller/restaurants/{restaurantId}/finance", "6"),
        ("S-07", "Seller analytics", "seller", "/seller/restaurants/:restaurantId/analytics", "get", "/seller/restaurants/{restaurantId}/analytics", "6"),
        ("R-01", "Rider verification", "rider", "/rider/onboarding", "post", "/rider/application", "2"),
        ("R-02", "Availability", "rider", "/rider/dashboard", "post", "/rider/availability", "5"),
        ("R-03", "Offers/dispatch", "rider", "/rider/offers", "get", "/rider/offers", "5"),
        ("R-04", "Pickup/completion", "rider", "/rider/deliveries/:deliveryId", "post", "/rider/deliveries/{deliveryId}/pickup", "5"),
        ("R-05", "GPS ingestion", "rider", "/rider/dashboard", "post", "/rider/location", "5"),
        ("R-06", "Rider earnings", "rider", "/rider/earnings", "get", "/rider/earnings", "6"),
        ("R-07", "Delivery incidents", "rider", "/rider/deliveries/:deliveryId", "post", "/rider/deliveries/{deliveryId}/incidents", "5"),
        ("A-01", "Verification decisions", "admin", "/admin/verifications", "get", "/admin/verifications", "2"),
        ("A-02", "Marketplace controls", "admin", "/admin/zones", "post", "/admin/zones", "6"),
        ("A-03", "Live operations", "admin", "/admin/orders", "get", "/admin/orders", "5,6"),
        ("A-04", "Support queue", "admin", "/admin/support", "get", "/admin/support/tickets", "6"),
        ("A-05", "Finance/refund reconciliation", "admin", "/admin/settlements", "get", "/admin/settlements", "6"),
        ("A-06", "Audit/governance", "admin", "/admin/audit", "get", "/admin/audit", "6"),
        ("A-07", "Reports", "admin", "/admin/reports", "get", "/admin/reports", "6"),
    ]
    dest = ROOT / "docs/phase-0/traceability.csv"
    with dest.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["requirement_id", "acceptance_scope", "workspace", "route", "method", "api_path", "operation_id", "owner", "target_phase", "status", "evidence"])
        for rid, desc, workspace, route, method, path, phase in rows:
            operation = api["paths"][path][method]
            writer.writerow([rid, desc, workspace, route, method.upper(), path, operation["operationId"], operation["x-owner"], phase, "designed-not-implemented", "pending implementation tests"])
        for rid, desc, evidence in [
            ("P0-DISC-03", "Decision owners and safe fallback", "docs/phase-0/DISCOVERY.md"),
            ("P0-DISC-04", "External readiness truthfully recorded", "docs/phase-0/PROVIDERS-AND-FEASIBILITY.md"),
            ("P0-NAV-01", "Unique declared route/access/states baseline", "contracts/routes.json"),
            ("P0-NAV-02", "Critical CTA to operation linkage", "contracts/actions.json"),
            ("P0-NAV-03", "Deep-link/history/unknown route acceptance design", "docs/QUALITY-AND-LAUNCH.md"),
            ("P0-UX-01", "Token text contrast baseline", "design/tokens.css"),
            ("P0-UX-02", "Component failure state design", "docs/phase-0/DESIGN-SYSTEM.md"),
            ("P0-UX-03", "Wireframe action and route agreement baseline", "docs/phase-0/DESIGN-SYSTEM.md"),
        ]:
            writer.writerow([rid, desc, "all", "", "", "", "", "product/engineering", "0", "design-baseline-delivered", evidence])


def main():
    routes = build_routes()
    api = build_openapi(inventory())
    write_json("routes.json", routes)
    write_json("openapi.json", api)
    write_json("events.schema.json", build_events())
    write_json("socket.schema.json", build_sockets())
    write_json("actions.json", build_actions())
    build_traceability(routes, api)
    print(f"Generated {len(routes['routes'])} routes and {sum(len(v) for v in api['paths'].values())} HTTP operations.")


if __name__ == "__main__":
    main()
