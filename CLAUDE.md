# OpenCRVS regression tests

The QA team owns this repository. Each test automates one or more TestRail test cases. The tests run against a deployed OpenCRVS environment with the Farajaland country configuration. The default environment is `qa.opencrvs.dev`. Set `DOMAIN` to use a different one. `package.json` has the commands.

Write all text that a person reads (comments, test titles, commit messages) in Simplified Technical English: short sentences, active voice, common words, one topic in each sentence.

## Choosing what to automate

The QA team decides what to test and how. TestRail is the source. Each TestRail case has an **Automation priority** field. The field is required. Fix failing tests first, then automate the cases in this order:

1. **Critical:** automate the case in the current release.
2. **High:** core workflows that need the most manual effort or a lot of test data, for example declare a birth, register a record, or correct a record. A failure here stops a user from doing their work.
3. **Medium:** admin features, for example create a user, edit a user, or look at performance metrics. A failure here does not stop the work in a registration office, or it has a workaround.
4. **Low:** small details, for example the validation of the child's birth weight. A failure here can cause a corner case or a minor data error, but it does not stop a workflow.

Some cases cannot easily be automated, for example the 2FA code that the user gets in an SMS. Add each such case to `NOT-AUTOMATED.md` with the reason, so that the QA team can keep it in the manual regression.

## Automating a TestRail case

1. Read the whole TestRail case: preconditions, steps, and expected results.
2. Search `tests/` for the case ID. If a test already has the ID, extend that test.
3. Look for a test of the same feature in `packages/testland/e2e/testcases` in [opencrvs-core](https://github.com/opencrvs/opencrvs-core). Reuse its selectors and its way to wait for the application.
4. Put the test in `tests/<suite>/<section>/`. Use the suite key and the section key from `support/testrail.map.ts` (see [TestRail map](#testrail-map)).
   - Give the spec file a short name that tells what the test does, for example `revoke-and-reinstate.spec.ts`.
   - If a test covers cases from more than one section, put it in the section of its main case.
   - If the case is in a TestRail subsection, use the folder of the parent section.
5. Create the test data through the API (see [Test data](#test-data)). Use the UI only for the behaviour that the case tests.
6. Write one `test()` for each scenario. Use one `test.step()` for each TestRail step, with the expected result as an `expect`.
7. Run the test three times with `pnpm test <file> --repeat-each 3`. All three runs must pass.
8. Run `pnpm typecheck`, `pnpm lint` and `pnpm format:check`. The pull request checks run the same commands.

The work is complete when each expected result in the TestRail case has an `expect`, or has a comment that tells why it does not.

## TestRail case IDs

Add each TestRail case ID that a test covers as a tag:

```ts
test(
  'Revoke and reinstate record',
  { tag: ['@C808', '@C809'] },
  async ({ page }) => {
    // ...
  }
)
```

- A test can cover more than one case. A case can be split across more than one test.
- Add the tag of each case that the test checks.
- If a case is split across more than one test, add the tag to each test.
- If no test checks an expected result of the case, add a comment in the test that tells which result and why.
- Each test is for a TestRail case. It has at least one case tag.
- `pnpm test --grep @C808` runs the tests for one case.

## TestRail map

`support/testrail.map.ts` lists the TestRail suites and their sections. Each suite key is a folder in `tests/`. Each section key is a folder in its suite folder. The spec files go in the section folder: `tests/<suite>/<section>/<name>.spec.ts`.

- Use only the folder names that are in the map.
- If TestRail gets a new suite or section, add it to the map in the same pull request as the test.
- If the name of a suite or section changes in TestRail, change the key in the map and rename the folder in the same pull request.
- The map has only suites and sections. Do not add test cases or file paths to it. The case tags in the tests show the coverage.

## Test principles

Follow the [Playwright best practices](https://playwright.dev/docs/best-practices). In addition:

- **Independent.** A test creates all the data that it needs. It does not use data from other tests, and it does not depend on test order. Do not use `test.describe.serial`. Then we can run one test again, and retry only the tests that fail.
- **Parallel.** All tests run in parallel, and other tests use the same users at the same time. Give each record a random name (`faker`), and find the record by that name.
- **No flaky tests.** A flaky test gives a false failure, and then nobody trusts the suite. Examine each failure. Find the cause, and fix it. Do not add a retry or a longer timeout to hide it. On CI, the config retries a failed test once. This is only so that we can find the flaky tests. The weekly run lists each test that needed a retry in the run summary and in the Slack message. Fix a failing or flaky test before you automate new cases.
- **No fixed waits.** `page.waitForTimeout()` is not permitted in `tests/`. Some helpers in `support/` still use it. Remove those calls when you change the helper. Wait for a response, or use a web-first assertion (`await expect(locator).toBeVisible()`), which waits for the condition.
- **Self-healing.** A test can fail only because the UI changed, for example a new label. During a regression run, find these failures and update the test. A failure that shows a change in behaviour is a bug. Report it, and do not change the test to pass.
- **Coverage.** The tags (see [TestRail case IDs](#testrail-case-ids)) show which TestRail cases are automated. Keep them correct, because the coverage report counts them.
- **Stable selectors.** The UI changes frequently. Use selectors in this order: `getByTestId`, an element `id`, `getByRole` with a name, `getByText`. Do not use CSS classes or the structure of the page.

## Login

- `login(page, CREDENTIALS.<ROLE>)` in `support/helpers.ts` logs in through the API and creates the PIN. Use it in almost all tests.
- Log in through the login app, as a real user does, only when the TestRail case is about login.
- Tests cannot share a saved login session (`storageState`). The auth service replaces the refresh token each time the client refreshes the session. When a test uses an old refresh token, the auth service logs out all copies of the session.
- The client loads the locations when the user logs in. If the test creates or changes a location, do that before `login()`.
- Each user in `CREDENTIALS` has the password `TEST_USER_PASSWORD` and the 2FA code `000000`.
- A new user's username is not always `<initial>.<surname>`, for example when the surname has an apostrophe. Use `getExpectedUsername()` from `support/test-data/api-actions.ts`.

## Test data

`support/test-data/` creates records through the API, for example `createDeclaration()` in `birth-declaration.ts` and `death-declaration.ts`. This is much faster than the UI. Use the UI to fill a form only when the TestRail case tests that form.

The tests change data on a shared environment. Make new locations and users with random names. Do not change the seeded Farajaland offices, users or locations, because other tests use them.

## Waiting for the application

The client works offline. It sends actions and does not wait for the result, and it polls the workqueues all the time. So an element can show before the data is saved, or the page can change after the test clicks. Use these helpers from `support/`:

- `openRecordByTitle(page, name)` opens a record from a workqueue. A plain click on the name can open a different record when the workqueue updates.
- `ensureAssignedToUser(page, username)` assigns the record to the user on the **Summary** tab. It does not work on the **Audit** or **Record** tabs.
- `triggerDeclarationAction(page, action)` selects an action in the action menu and waits for all the action responses.
- For other actions, wait for the response with `page.waitForResponse()`. Know which request you wait for.

After an action, the client sends a `POST` to `event.search` with the event ID in the body to update its cache. To wait for it, match the event ID in `request.postData()`, and accept the response only after the action response arrives. Other `event.search` calls go to the same URL. `triggerDeclarationAction` does this with `{ waitForUnassign: true, eventId }`.

## Source of the support code

`support/` is a copy of `packages/testland/e2e/support` in [opencrvs-core](https://github.com/opencrvs/opencrvs-core). It does not update automatically. When a helper in this repository breaks, compare it with the version in core.

The version of `@opencrvs/toolkit` in `package.json` must match the version of OpenCRVS on the environment.
