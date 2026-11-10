# OpenCRVS regression tests

Automated regression tests for [OpenCRVS](https://github.com/opencrvs/opencrvs-core). The QA team owns these tests. Each test automates one or more TestRail test cases.

## Run the tests

You need Node.js (see `.nvmrc`) and pnpm.

```bash
pnpm install
pnpm exec playwright install chromium
pnpm test                    # all tests against qa.opencrvs.dev
pnpm test --grep @C808       # the tests for one TestRail case
DOMAIN=example.opencrvs.dev pnpm test
pnpm report                  # open the last HTML report
```

GitHub Actions runs all the tests every night against `qa.opencrvs.dev`. You can also start a run from the **Actions** tab. The run uploads the HTML report and a CTRF JSON report.

When a run fails, a Slack message goes to the QA channel. The message lists the failed tests and has a link to the run.

## Pull requests

Push to `develop` only through a pull request. Each pull request runs these checks:

- `pnpm lint`, `pnpm typecheck` and `pnpm format:check`.
- The tests that the pull request changes, against `qa.opencrvs.dev`. A test also runs when a file that it imports changes, for example a helper in `support/`. When `package.json`, `pnpm-lock.yaml`, `.nvmrc` or `playwright.config.ts` changes, all the tests run. Each test runs three times with no retry, so a flaky test fails the check.

## Write a test

Read [CLAUDE.md](CLAUDE.md). It has the conventions and the steps to automate a TestRail case. Claude Code reads the same file.
