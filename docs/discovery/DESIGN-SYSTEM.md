# CraveCart design specification

## Direction

Photographic, presentation-led customer experience inspired by the supplied Zomato references, with original CraveCart identity: a restrained crimson primary, white/blush sections, large centered typography and a dark photographic hero. India-wide discovery replaces the earlier city-only launch page. Operational workspaces remain calm and legible.

The [CSS tokens](../../design/tokens.css) provide shared semantic values. The implemented React landing, city discovery and modal styles are in `apps/web/src/redesign.css`. Asset provenance and exact generation prompts are recorded in [the image register](../../design/ASSETS.md).

| Foundation | Rule |
|---|---|
| Typography | Locally bundled Plus Jakarta Sans with a system fallback; clear hierarchy and tabular numbers for money/timers |
| Spacing | 4px base scale; 16px mobile page gutter, 24–32px desktop |
| Customer content | Max 1280px; restaurant grid 1/2/3/4 columns based on usable width |
| Operations | Persistent desktop sidebar, dense filters, explicit current restaurant/workspace |
| Mobile | 44px minimum interactive target; rider primary controls 48px+; safe-area padding |
| Breakpoints | 640px, 960px and 1280px as layout guidance; content dictates wrapping |
| Focus | Visible 3px ring with separation, keyboard reachable dialogs and menus |
| Status | Icon + text + color; never red/green/sound alone |
| Motion | Short feedback transitions; reduced-motion disables nonessential animation |

## Component contracts

| Component | Required states/behavior |
|---|---|
| Button | Default, hover, focus, disabled-with-reason, submitting, success/error feedback; submit lock does not replace backend idempotency |
| Form field | Label, description, required indicator, validation message, safe retained value, appropriate autocomplete |
| Dialog | Accessible name, focus trap/restore, escape behavior; irreversible actions show effect and explicit confirm |
| Restaurant card | Image fallback, name, cuisine, rating count, qualified ETA, fees, closed/unserved label; one unambiguous link |
| Dish configurator | Variant/modifier limits, price update, sold-out choices, keyboard operation |
| Money summary | Currency and minor-unit formatting, named fee/tax/discount lines, total and policy link |
| Status timeline | Applied state, timestamps, pending operation label, cancellation/refund state kept separate |
| Tracking map | Last accepted sample time, accuracy/staleness, ETA range, text fallback and support link |
| Order/offer alert | Persisted inbox entry, visual badge/banner, optional enabled sound; expiry/ack stops repeated ringing |
| Table/filter bar | Sort/pagination, URL filter state, loading skeleton, empty result, bounded export |
| Assistant bubble | Source/tool-backed facts, streaming/failed state, structured proposal, explicit confirmation, actual result link |

## Low-fidelity page layouts

```text
CUSTOMER DISCOVERY (desktop)
[CraveCart] [Deliver to: selected address v] [Search] [Account] [Cart n]
[Location/serviceability banner when needed]
[Cuisine / dietary / rating / price filters]
[Restaurant card] [Restaurant card] [Restaurant card]
[Pagination / load more]                        [Assistant]

CHECKOUT (desktop; stack on mobile)
[Back to cart] [Delivery address + edit]       [Item summary]
[Delivery instructions]                      [Fees/discount/tax/tip]
[Payment capability/method]                  [Total / quote expiry]
[Cancellation policy]                        [Place and pay]
[Inline errors / pending state; preserve cart]

SELLER OPERATIONS
[Workspace + restaurant selector] [Availability] [Alerts]
[Sidebar] [Incoming | Preparing | Ready | History] [Filters]
          [Order card + age + items + notes] [Allowed action]
          [Preparation estimate / rejection reason dialog]

RIDER MOBILE
[Online / Offline] [GPS/network health]
[Active delivery / offer expiry]
[Current step: pickup or delivery]
[Map + last update + route estimate]
[Navigate] [Verify pickup / Complete]
[Report issue] [Support]

ADMIN OPERATIONS
[Workspace] [Global filters] [Operational alerts]
[Sidebar] [Aged orders / no riders / payment exceptions]
          [Table with current applied state and timestamp]
          [Detail panel: evidence -> authorized action -> audit]
```

Mobile customer navigation: Home, Search, Orders, Account; cart remains visible as an explicit action with badge. Seller/admin sidebars collapse into an accessible drawer. Rider screen centers the active task; do not encourage interaction while driving.

## Accessibility and visual verification

Target WCAG 2.2 AA. Token foreground/background pairs must meet 4.5:1 for normal text; focus and component boundaries need separate UI checks. Automated token checks do not certify a composed interface. Later component verification must cover keyboard flows, dialog focus, screen reader status announcements, 200% zoom, reduced motion, image failures and 360px-wide screens.

**P0-UX-01:** Semantic tokens pass the declared text-contrast checks. **P0-UX-02:** Every component contract names failure/disabled states. **P0-UX-03:** Wireframe actions agree with the route/API inventory; no decorative dead controls ship.
