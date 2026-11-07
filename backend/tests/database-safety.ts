// Legacy integration suites clear whole tables. Require a deliberately supplied
// disposable database instead of silently using the application's DATABASE_URL.
const testPath = expect.getState().testPath ?? "";
if (/(?:phase\d|integration\.test)/.test(testPath)) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Integration tests require TEST_DATABASE_URL pointing to a disposable test database. No database operations were run.");
  const parsed = new URL(url);
  if (!/test/i.test(parsed.pathname)) throw new Error("TEST_DATABASE_URL database name must contain 'test'.");
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = url;
}
