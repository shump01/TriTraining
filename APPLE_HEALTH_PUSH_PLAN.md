# Apple Health push — auto-ingest on workout completion

Expands **Phase 7** of [MOBILE_APP_PLAN.md](MOBILE_APP_PLAN.md) (HealthKit background
delivery) into a concrete, verified plan. Server phases live in this repo; app phases in
`tritrainer-mobile`. Facts below were verified against Apple's documentation and the
libraries' sources (July 2026); the repo seams cite real files.

---

## 1. What "push" can and cannot mean

HealthKit has **no cloud API** — no REST endpoint, no webhooks, no server tokens. All
HealthKit data lives on-device; nothing can ever call our server from Apple's side. "Push
on completion" therefore means: **iOS wakes the companion app** when a workout sample is
saved (`HKObserverQuery` + `enableBackgroundDelivery(.immediate)`), and the app uploads to
`POST /api/health/ingest`.

**The latency contract we can honestly promise** — "usually within a minute or two of the
workout saving; guaranteed by the next unlock or app open":

| Constraint             | Verified behavior                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workout type frequency | `HKWorkoutType` supports `.immediate` background delivery (some quantity types, e.g. steps, are capped hourly). `.immediate` is a **maximum**, not a schedule — the system may batch/delay for battery reasons.            |
| Device locked          | The Health store is encrypted while locked. The background wake **may still fire**, but reads fail with `errorDatabaseInaccessible` (Apple DTS) — handle it, call the completion handler, retry on next wake/foreground.   |
| Force-quit             | iOS will not relaunch a force-quit app for background delivery until the user reopens it. The `enableBackgroundDelivery` **registration itself persists** across force-quit and reboot, so deliveries resume on next open. |
| Completion handler     | Must be called promptly after processing; repeatedly failing to call it makes iOS retry then throttle deliveries. Keep the handler to "query + upload", nothing more.                                                      |
| Entitlement            | `com.apple.developer.healthkit.background-delivery` is required (iOS 15+); without it `enableBackgroundDelivery` fails with `errorAuthorizationDenied`.                                                                    |
| Registration timing    | Observer queries must be instantiated in `application(_:didFinishLaunchingOptions:)` — a JS-side subscription alone cannot receive terminated-state deliveries.                                                            |
| Watch → iPhone         | A Watch workout syncs to the iPhone store shortly after the workout ends when the phone is in range — usually well under a minute.                                                                                         |
| Simulator              | Background delivery does not work in the Simulator. All testing is physical-device.                                                                                                                                        |

**Key structural insight:** `/api/health/ingest` is an **idempotent full-replace**
([src/lib/health/ingest.ts](src/lib/health/ingest.ts)) — the app always sends everything
since the earliest plan week, and the server rewrites all `APPLE_HEALTH` rows in one
transaction. So the background wake handler simply re-runs the _same sync the "Sync now"
button runs_. No delta protocol, no server-side anchors; deletes and edits reconcile for
free. **Push of today's data (weekly distance) needs zero server change — it is entirely
app-side work.** Phases 1–2 are the value multiplier: carrying HR + duration so
Apple-Watch-only athletes get the training-load features (Fitness/Fatigue/Form, zones, the
Form-aware re-ramp) that are currently Strava-only.

---

## 2. Phase 1 — Server (this repo): teach ingest about training load

### Schema (one migration, additive-safe on the live DB)

`ActivityLoad` generalizes from Strava-only to per-source:

- Rename the Prisma field `stravaActivityId` → `externalId` **keeping the physical column
  via `@map("stravaActivityId")`** — zero data migration. The id is a Strava activity id
  or a HealthKit workout UUID depending on source.
- Add `source ActualSource @default(STRAVA)` (`ADD COLUMN` with a constant default is
  metadata-only in Postgres; `MANUAL` is a legal enum value that is simply never written).
- Unique key `(userId, stravaActivityId)` → `(userId, source, externalId)` — strictly
  weaker, so existing rows cannot conflict. Name the index explicitly in the schema so the
  hand-written SQL and Prisma agree.

### Two landmines (verified; both must land before any Apple load row exists)

1. **Strava sync wipes foreign rows.** [src/lib/strava/sync.ts](src/lib/strava/sync.ts)
   deletes `ActivityLoad` by `userId + date` with **no source filter** — every Strava sync
   would erase Apple Health load rows. Scope the delete to `source: STRAVA`. (Both
   `WeeklyActual` paths are already source-scoped; this one predates sources.)
2. **Double-counting into the re-ramp.** `readUserLoad`
   ([src/lib/load-data.ts](src/lib/load-data.ts)) reads all rows unfiltered. A workout
   arriving from both Strava auto-upload _and_ Health push would double its TSS into the
   Load page, two mobile APIs, the plan page's Form signal — and the adaptive re-ramp's
   Form factor, silently shrinking future targets. **Rule: one source feeds load**
   (mirrors the "precedence, never summed" doctrine of weekly actuals): `STRAVA` when a
   `StravaConnection` exists, else `APPLE_HEALTH`, filtered at read time. A per-user
   override toggle is a deferred fast-follow if the auto rule proves wrong for someone.

### Ingest contract

Extend `healthIngestSchema` ([src/lib/validation.ts](src/lib/validation.ts)) with
**all-optional** per-workout fields — old app payloads keep validating; new payloads
against an old server are stripped harmlessly:

- `externalId` — the `HKWorkout` UUID string (idempotency key);
- `movingSeconds` — workout duration;
- `avgHr` — average heart rate over the workout.

Workouts carrying all three map into the existing `ActivityHrInput` and reuse
[`buildActivityLoadRows`](src/lib/strava/sync-core.ts) unchanged (it already drops
unmapped sports and HR-less entries). The ingest transaction gains a source-scoped
delete + `createMany` for `APPLE_HEALTH` load rows — an exact mirror of the weekly-actual
replace, `skipDuplicates` for the same concurrent-ingest reason.

### Tests

Ingest idempotency including load rows; each sync path deleting only its own source; the
load-source rule; a legacy (distance-only) payload writing zero load rows; validation
bounds on the new fields.

> ⚠ **Deploy:** needs `npx prisma migrate deploy` before restart — the code selects the
> new `source` column. Same drill as the pause feature.

## 3. Phase 2 — App: enrich the existing foreground sync

Add the heart-rate **read permission** (workout distance alone doesn't grant it); send
`externalId` (workout UUID), duration, and average HR (from the workout's statistics) in
the existing sync payload. **Ships value before push lands:** Apple-only athletes get
Form/zones/re-ramp easing via manual sync. No server change beyond Phase 1.

## 4. Phase 3 — App: the push itself

**Library decision — do not build this on `react-native-health`.** Verified: effectively
frozen (last release Oct 2024, 157 open issues); its Expo config plugin states verbatim
that background processing is not supported (a custom Swift AppDelegate mod would be
needed); and its native observer path **drops events that arrive before the JS runtime
boots** — the exact race this feature lives in.

Use **`@kingstinct/react-native-healthkit` ≥ 14** (actively maintained; Nitro-modules).
Its Expo config plugin adds the background-delivery entitlement and auto-injects a native
`BackgroundDeliveryManager` into the Swift AppDelegate that (a) re-registers observer
queries at cold launch, per Apple's requirement, and (b) **queues events that fire before
JS is ready** and replays them on subscribe. The two libraries coexist during transition
(thin wrappers over the same store); migrate foreground reads off `react-native-health`
as a follow-up rather than carrying an unmaintained dependency for half the pipeline.

Implementation sketch:

1. Config plugin on (background delivery defaults on), rebuild the custom dev client.
2. After HealthKit authorization:
   `configureBackgroundTypes(["HKWorkoutTypeIdentifier"], UpdateFrequency.immediate)` —
   once.
3. `subscribeToChanges("HKWorkoutTypeIdentifier", handler)` at **module top level** (not
   inside the React tree), so the handler exists as early as possible after a background
   boot.
4. The handler re-runs the existing full-window sync (query all workouts since the
   earliest plan week → normalize → `POST /api/health/ingest`). The idempotent server
   makes anchors unnecessary; `queryWorkoutSamplesWithAnchor` stays available if the
   window ever gets large.
5. Edge handling: `errorDatabaseInaccessible` (woken while locked) → give up quietly,
   retry on next wake/foreground; network failure → persist a dirty flag, flush on next
   wake/open (idempotent replace makes retries safe). Never block the completion handler.
6. Keep the on-launch foreground sync as the reliability net.
7. Test protocol (device only): a manual workout entry in the Health app triggers the
   observer; verify killed-state delivery via TestFlight; assert the server row appears
   without opening the app.

## 5. Phase 4 — Polish

- Apple Health card shows auto-sync freshness ("auto-synced 12 min ago").
- Settings copy for the honest contract: syncs automatically after workouts while the
  phone is unlocked; opening the app always catches up.
- The recommend-one-auto-source note from MOBILE_APP_PLAN §4.4; the per-user load-source
  toggle only if the auto rule proves insufficient.

---

## 6. Order and shippability

Each phase ships independently, but the order is load-bearing:

- **Phase 1 must deploy before Phase 2 payloads arrive** — otherwise the unscoped Strava
  delete erases Apple load rows, and load rows would double-count with no read-time rule.
- Phase 3 alone (skipping 1–2) would give push of today's weekly distances with **zero
  server change** — a valid minimal path, at the cost of the training-load win.
- Recommended: 1 → 2 → 3 → 4.
