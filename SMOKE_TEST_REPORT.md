# PharmaDash verification — 11 September 2026

## Final results

| Check | Result |
| --- | --- |
| Backend TypeScript build | Passed |
| Frontend ESLint | Passed, zero errors/warnings |
| Frontend production build | Passed |
| Full automated suite | **97 tests passed across 8 suites** |
| Fresh PostgreSQL migration deployment | Passed, all 4 migrations |
| Concurrent checkout and rollback | Passed against real disposable PostgreSQL |
| Prescription lifecycle | Passed: real OCR, upload, local image retrieval, pharmacist claim/approval, COD, pickup, OTP delivery and feedback |
| SOS priority | Passed: persisted flag, fee, priority listing, concurrent dedicated-rider enforcement |
| Concurrent cancellation | Passed: both requests succeed, stock restored exactly once |
| Tracking | Passed: real Socket.IO connections, private rooms, zero coordinates, updates after reconnect |
| Razorpay adapter and refunds | Passed with simulated provider responses plus real database and signed webhook requests |
| S3 adapter | Passed with simulated S3 responses |
| Previous live read-only smoke | Passed for customer, rider, admin, pharmacist and public APIs (18 HTTP requests) |
| Previous browser smoke | Customer login, search, cart, prescription address entry and order list/detail passed; no captured console errors |
| Windows production startup/SPA routes | Passed |
| Git whitespace validation | Passed |

The full runner provisions a loopback-only PostgreSQL instance and a new disposable database for every run. Tests do not use the configured application database. OCR uses the committed synthetic text-image fixture. The PostgreSQL data and uploaded test files stay under ignored `backend/.test-data`.

## Repairs delivered

- Checkout validates input, charges the displayed delivery/SOS fees, rounds discounts, preserves the selected payment method and collects prescription delivery addresses.
- SOS is implemented end to end: persisted order flag, 99 fee, priority sorting and one dedicated delivery at a time. A database row lock prevents a rider from concurrently claiming SOS and regular deliveries.
- Order responses preserve rider/pharmacy details, medicine IDs/prices, prescription flags and feedback without exposing OTP hashes. Reorders preserve quantities and active filters include prescription-pending orders.
- Authentication no longer logs users out on a 403; pharmacy staff are scoped to their assigned pharmacy, and riders cannot read prescription images.
- Expired stock is excluded from catalogue availability; malformed JSON, authentication, pagination, status, feedback, checkout and OTP inputs are handled.
- The scanner uses actual OCR and exact catalogue matches instead of fabricated medicine IDs. Uploaded prescriptions remain available for manual pharmacist review when OCR cannot read them, including PDFs.
- Tracking refreshes authentication, rejoins after reconnects and rejects invalid coordinates. React effects, corrupted cart recovery and prescription image cleanup are repaired.
- Customer cancellation is routed correctly, restores stock once under concurrency, and invokes refunds for paid Razorpay orders. Concurrent refund dispatch is guarded; ambiguous provider failures retain REFUND_PENDING for reconciliation instead of retrying a potentially completed refund.
- Webhook database failures return a retryable response; amount/currency/capture checks are enforced and cancelled orders are not restored to PENDING.
- Windows startup, environment loading, same-origin API proxying and lint failures are fixed.
- Fresh migration deployment handles the historical baseline/payment migration ordering without renaming or modifying applied migrations. Docker startup includes the migration bootstrap and new SOS migration.
- Compatible backend dependency security updates are recorded in the lockfile.

## Reproduce

From `backend`:

```powershell
npm ci
npm run db:generate
npm run build
npm run test:integration
```

The integration runner downloads platform-specific PostgreSQL binaries through its npm development dependency. It binds PostgreSQL to loopback port 55432; set `TEST_PG_PORT` if necessary. Direct `npm test` requires an explicitly supplied disposable `TEST_DATABASE_URL` whose database name contains `test`. Existing integration suites clear tables and must never target application data.

For faster mocked smoke checks, use `npm run test:smoke`. With the application running and documented demo accounts seeded, `node scripts/smoke-readonly.cjs` checks APIs without changing orders or inventory. Set `SMOKE_BASE_URL` for a different API address.

From `customer-app`, run `npm run lint` and `npm run build`.

Deployments must regenerate Prisma and apply migrations. The Docker entrypoint runs `node scripts/migrate-deploy.cjs`; use that command for non-Docker deployment as well.

## Operational limits

- No Razorpay test key/secret or S3 sandbox bucket is configured. Real provider checkout, external webhook delivery and S3 network behavior remain unverified; provider simulations are not live-provider tests.
- Tracking tests inject coordinates over real sockets. Physical-device GPS/location permissions still require a device check.
- After compatible dependency updates, npm still reported four tooling advisories: three high-severity entries along the Prisma configuration/deepmerge-ts chain and one low-severity esbuild entry. No forced Prisma downgrade or unsupported major override was applied.
- No manual production database migration or real payment/refund was performed. A push may trigger the repository's configured deployment automation.
- The pre-existing untracked `test-prod.js` was not run, modified or included in the commit.
