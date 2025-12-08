# Driver Pro Suite Implementation Roadmap

## Scope Overview
- Walk-in flow upgrades (persistent drop-off picker, navigation CTAs everywhere, auto tariff recovery).
- Smart drop-off intelligence (recent destinations, reverse-geocode context, backend traceability).
- Driver guidance utilities (navigation helper, deviation hints, KPI dashboard tiles).
- Backend payload extensions for walk-in auditing + owner/dispatch surfacing.
- Regression test coverage (API + RN unit tests) for the new flows.

## Phase 1 – Walk-In & Navigation Reliability
1. Reuse the drop-off picker inside JobPaused + any walk-in preview cards so drivers can set/change destination mid-ride.
2. Centralise external navigation launching in a helper and use it in ActiveRide, JobPaused, JobStatusCards, etc.
3. Auto-heal tariff selection if the stored tariff disappears; surface prompts when entering a new zone.

## Phase 2 – Drop-off Intelligence & Traceability
1. Persist last N drop-offs per company/zone (client cache + backend storage) and render as quick chips.
2. Reverse-geocode drop-offs before enqueueing walk-ins; sync metadata to dispatch/owner UIs.
3. Extend walk-in create payloads + owner/dispatch endpoints with drop-off metadata, tariff snapshot, and optional map snapshot link.

## Phase 3 – Guidance + Metrics
1. Add Home KPI cards for earnings vs. forecast, wait-time ratio, and speed compliance; hook into ShiftContext timers.
2. Introduce a guidance banner (Active/Paused screens) that detects long deviation from dispatch path and suggests re-navigation.
3. Explore in-app routing fallback (Mapbox/OSRM) for fleets without Google/Waze access.

## Phase 4 – Testing & Hardening
1. Backend integration tests for `/mobile/driver/jobs/walk-in/create` with/without drop-off payloads.
2. RN Jest tests for the drop-off picker state machine and navigation helper fallback logic.
3. Regression pass on walk-in start-to-payment flow.

> This doc will evolve as each phase lands; keep notes + follow-up tasks appended here.
