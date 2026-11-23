/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * OpenCRVS is also distributed under the terms of the Civil Registration
 * & Healthcare Disclaimer located at http://opencrvs.org/license.
 *
 * Copyright (C) The OpenCRVS Authors located at https://github.com/opencrvs/opencrvs-core/blob/master/AUTHORS.
 */
import { faker } from '@faker-js/faker'
import { expect, Locator, Page, test } from '@playwright/test'
import { CREDENTIALS } from '@support/constants'
import { login } from '@support/helpers'
import {
  changeLastCharacter,
  createExtraCheckRecords,
  invalidId,
  createIdRecord,
  createNameRecords,
  createShortNameRecord,
  waitUntilSearchable
} from '@support/search/quick-search-records'

/*
 * TestRail C2491 "Validate quick search options" is split into tests by the
 * records that they need. Each test creates its own records.
 *
 * | Test                                   | C2491 steps                     |
 * | Search bar text and Advanced Search    | 1, 8                            |
 * | Search by ID, phone and email          | 2, 4, 5, 6, 7                   |
 * | Search by name                         | 3.1-3.4, fuzzy rule on TD-01    |
 * | Fuzzy rule on short names              | 3 (fuzzy rule on TD-03)         |
 * | Extra checks (not in TestRail C2491)   | none                            |
 *
 * The checks of an expected result are soft (expect.soft): a failed check
 * is reported, and the test continues with the next check and step. The
 * test still fails at the end. The waits that the later checks need (login,
 * records, search result page, result pages) are hard and stop the test.
 */

/** How the search is sent: the Enter key, or a click on the search icon. */
type Submit = 'enter' | 'icon'

function rowOf(page: Page, title: string) {
  return page
    .locator('[id^="row_"]')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) })
}

/**
 * The longest time that the test waits for the result page of a search.
 * The page shows the new results only when the search response and the
 * requests that follow it (for example the drafts and the user) are all
 * back. On a busy environment this can take more than 5 seconds.
 */
const SEARCH_RESULT_TIMEOUT = 30_000

/** Types the term in the search bar, sends it, and waits for the result page. */
async function search(page: Page, term: string, submit: Submit = 'enter') {
  const input = page.locator('#searchText')
  await input.fill(term)
  if (submit === 'enter') {
    await input.press('Enter')
  } else {
    await page.locator('#searchIconButton').click()
  }
  // The search is sent: the address shows the new term.
  await expect
    .poll(() => new URL(page.url()).searchParams.get('term'), {
      message: `The search for "${term}" was not sent`
    })
    .toBe(term)
  // The page shows the previous results until the new results are ready.
  // The heading and the rows come from the same response, so the rows are
  // for this term when the heading shows it.
  await expect(page.locator('#content-name')).toHaveText(
    `Search result for “${term}”`,
    { timeout: SEARCH_RESULT_TIMEOUT }
  )
}

/** Waits until the search shows a result list or a "No results" text. */
async function waitForResultPage(page: Page, term: string) {
  await expect(
    page
      .getByText(`No results for “${term}”`)
      .or(page.locator('[id^="row_"]').first())
  ).toBeVisible()
}

/**
 * The row has 3 visible buttons: the record name, the primary action and
 * the download button ("Assign record"). The label of the primary action
 * changes with the status, so the test checks the other two by name and
 * the primary action as the third visible button.
 */
async function expectRowActions(row: Locator, title: string) {
  const buttons = row.getByRole('button')
  await expect.soft(buttons, `Row buttons of ${title}`).toHaveCount(3)
  for (const button of await buttons.all()) {
    await expect.soft(button).toBeVisible()
  }
  await expect
    .soft(row.getByRole('button', { name: title, exact: true }))
    .toBeVisible()
  await expect
    .soft(row.getByRole('button', { name: 'Assign record' }))
    .toBeVisible()
}

const MAX_RESULT_PAGES = 30
const RESULTS_PER_PAGE = 10

/**
 * Searches for the term once and returns which of the titles are in the
 * results, on any result page (10 rows on each page). Records from earlier
 * runs stay on the shared environment, so a record is not always on page 1.
 */
async function findInResults(
  page: Page,
  term: string,
  titles: string[],
  submit: Submit = 'enter'
) {
  await search(page, term, submit)
  await waitForResultPage(page, term)
  const found = new Set<string>()
  // The pagination is in the same render as the rows. It shows only when
  // there is more than 1 page. The page has 2 next buttons (one for each
  // screen layout), so the test uses the visible one.
  const next = page.locator('#next-page-button').filter({ visible: true })
  const firstTitle = page
    .locator('[id^="row_"]')
    .first()
    .getByRole('button')
    .first()
  for (let pageNumber = 1; pageNumber <= MAX_RESULT_PAGES; pageNumber++) {
    for (const title of titles) {
      if ((await rowOf(page, title).count()) > 0) found.add(title)
    }
    if (found.size === titles.length) return found
    if (!(await next.isVisible()) || (await next.isDisabled())) return found
    // Each page numbers its rows from row_0, so the test waits for the
    // offset in the address and for a different record in the first row.
    const previousFirstTitle = (await firstTitle.textContent()) ?? ''
    await next.click()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('offset'))
      .toBe(String(pageNumber * RESULTS_PER_PAGE))
    await expect(firstTitle).not.toHaveText(previousFirstTitle, {
      timeout: SEARCH_RESULT_TIMEOUT
    })
  }
  throw new Error(
    `"${term}" has more than ${MAX_RESULT_PAGES} result pages. Use a rarer name.`
  )
}

/**
 * Searches for the term once. Each record in `shown` must be in the
 * results. Each record in `hidden` must not be in the results.
 */
async function expectResults(
  page: Page,
  term: string,
  { shown = [], hidden = [] }: { shown?: string[]; hidden?: string[] }
) {
  const found = await findInResults(page, term, [...shown, ...hidden])
  for (const title of shown) {
    expect.soft(found.has(title), `${title} is shown for "${term}"`).toBe(true)
  }
  for (const title of hidden) {
    expect
      .soft(found.has(title), `${title} is not shown for "${term}"`)
      .toBe(false)
  }
}

async function expectNoResults(
  page: Page,
  term: string,
  submit: Submit = 'enter'
) {
  await search(page, term, submit)
  await waitForResultPage(page, term)
  await expect.soft(page.getByText(`No results for “${term}”`)).toBeVisible()
}

const RECORD_PAGE_URL = /\/events\/[0-9a-f-]{36}(\?|$)/

/** Opens the record from its row and checks that its overview page opens. */
async function openFromResults(page: Page, title: string) {
  await rowOf(page, title)
    .getByRole('button', { name: title, exact: true })
    .click()
  await expect.soft(page, `Record page of ${title}`).toHaveURL(RECORD_PAGE_URL)
  await expect
    .soft(page.getByRole('heading', { name: title, level: 1 }))
    .toBeVisible()
  if (RECORD_PAGE_URL.test(page.url())) {
    // Go back to the result page. This is faster than loading the app
    // again.
    await page.goBack()
    await expect(page).toHaveURL(/[?&]term=/)
  }
}

/** A valid search shows the record as a row with its actions, and opens it. */
async function expectFoundAndOpen(
  page: Page,
  term: string,
  title: string,
  submit: Submit = 'enter'
) {
  // Quick search also searches the word as a fuzzy name, so other records
  // can be in the results. The record is not always on page 1.
  const row = await goToResultRow(page, term, title, submit)
  if (!row) return
  await expectRowActions(row, title)
  await openFromResults(page, title)
}

/** Logs in as the Local Registrar and waits until the search bar is on the page. */
async function loginAsLocalRegistrar(page: Page) {
  await login(page, CREDENTIALS.REGISTRAR)
  // The app loads its configuration after login. Wait until the search
  // bar is on the page, so that the steps check only the search. This is
  // the same wait as an action (no time limit other than the test timeout).
  await page.locator('#searchText').waitFor()
}

/**
 * Searches for the term, and stays on the result page that shows the
 * record. The record is not always on page 1. Returns undefined if the
 * record is not in the results (the soft check reports it).
 */
async function goToResultRow(
  page: Page,
  term: string,
  title: string,
  submit: Submit = 'enter'
) {
  const found = await findInResults(page, term, [title], submit)
  expect.soft(found.has(title), `${title} is shown for "${term}"`).toBe(true)
  return found.has(title) ? rowOf(page, title) : undefined
}

/** Searches for the term, and checks the row actions of the record. */
async function expectResultRowActions(page: Page, term: string, title: string) {
  const row = await goToResultRow(page, term, title)
  if (row) await expectRowActions(row, title)
}

/**
 * Searches by registration number. If the record has no registration
 * number, the soft check reports it and the searches do not run.
 */
async function expectRegistrationNumberSearch(
  page: Page,
  record: { registrationNumber?: string; title: string }
) {
  const { registrationNumber } = record
  expect
    .soft(registrationNumber, 'The record has a registration number')
    .toBeDefined()
  if (!registrationNumber) return
  await expectFoundAndOpen(page, registrationNumber, record.title)
  await expectNoResults(page, invalidId(registrationNumber))
}

test(
  'Quick search: search bar text and Advanced Search',
  { tag: ['@C2491'] },
  async ({ page }) => {
    await test.step('Setup - Log in as Local Registrar', async () => {
      await loginAsLocalRegistrar(page)
    })

    await test.step('1 - Search bar shows "Search for a record"', async () => {
      await expect
        .soft(page.locator('#searchText'))
        .toHaveAttribute('placeholder', 'Search for a record')
    })

    await test.step('8 - Advanced Search button opens Advanced Search', async () => {
      await page.locator('#searchType').click()
      await expect.soft(page).toHaveURL(/.*\/advanced-search/)
      await expect
        .soft(page.locator('#content-name'))
        .toHaveText('Advanced Search')
    })
  }
)

// The checks are in expectFoundAndOpen() and expectNoResults().
// eslint-disable-next-line playwright/expect-expect
test(
  'Quick search by tracking ID, registration number, NID, phone and email',
  { tag: ['@C2491'] },
  async ({ page }) => {
    const record = await test.step('Setup - Create a registered record', () =>
      createIdRecord())

    await test.step('Setup - Wait until the record is in search, and log in as Local Registrar', async () => {
      // The API search uses the same index and jurisdiction rules as the
      // search bar. The search bar is only used in the TestRail steps.
      await waitUntilSearchable([record])
      await loginAsLocalRegistrar(page)
    })

    await test.step('2 - Valid and invalid tracking ID', async () => {
      await expectFoundAndOpen(page, record.trackingId, record.title)
      await expectNoResults(page, invalidId(record.trackingId))
    })

    await test.step('4 - Valid and invalid registration number', async () => {
      await expectRegistrationNumberSearch(page, record)
    })

    await test.step('5 - Valid and invalid NID', async () => {
      await expectFoundAndOpen(page, record.motherNid, record.title)
      await expectNoResults(page, changeLastCharacter(record.motherNid))
    })

    await test.step('6 - Valid and invalid phone number', async () => {
      // Quick search matches phone numbers directly.
      // TestRail says "Click Search", so this step clicks the search icon.
      await expectFoundAndOpen(page, record.phone, record.title, 'icon')
      await expectNoResults(page, changeLastCharacter(record.phone), 'icon')
    })

    await test.step('7 - Valid and invalid email', async () => {
      // Quick search matches emails directly.
      // TestRail says "Click Search", so this step clicks the search icon.
      await expectFoundAndOpen(page, record.email, record.title, 'icon')
      // Invalid email 1 character away from the valid one: email search
      // must be an exact match.
      await expectNoResults(page, record.email.replace(/\.com$/, '.co'), 'icon')
      // Invalid email that no record uses.
      const randomEmail = `${faker.string.alpha({ length: 10, casing: 'lower' })}@example.com`
      await expectNoResults(page, randomEmail, 'icon')
    })
  }
)

// The checks are in expectResults() and expectNoResults().
// eslint-disable-next-line playwright/expect-expect
test('Quick search by name', { tag: ['@C2491'] }, async ({ page }) => {
  const { names, a, b, d } =
    await test.step('Setup - Create the records TD-01, TD-02 and TD-04', () =>
      createNameRecords())

  const t = names.terms

  await test.step('Setup - Wait until the records are in search, and log in as Local Registrar', async () => {
    await waitUntilSearchable([a, b, d])
    await loginAsLocalRegistrar(page)
  })

  // Every name of TD-01 is at least 3 edits from its other names, so each
  // search can find TD-01 only through the field that it tests. TD-02 has
  // a name 1 edit away in the same field. TD-04 is 3 edits away in the
  // child names.
  const nameFields: [string, string][] = [
    [names.a.childFirst, names.a.childSurname],
    [names.a.fatherFirst, names.a.fatherSurname],
    [names.a.informantFirst, names.a.informantSurname]
  ]

  await test.step('3.1 - Valid child, father, mother and informant names (first, last, full)', async () => {
    // First names and surnames: TD-01 and TD-02, not TD-04.
    for (const [first, surname] of nameFields) {
      for (const term of [first, surname]) {
        await expectResults(page, term, {
          shown: [a.title, b.title],
          hidden: [d.title]
        })
      }
    }

    // Mother names: only TD-01. The hyphen splits the surname into two
    // words.
    const [surnameStart, surnameEnd] = names.a.motherSurname.split('-')
    for (const term of [
      names.a.motherFirst,
      names.a.motherSurname,
      `${surnameStart} ${surnameEnd}`,
      surnameEnd
    ]) {
      await expectResults(page, term, { shown: [a.title], hidden: [b.title] })
    }

    // Full names. A full name matches when any one word matches, so these
    // searches show that the record is found. They cannot test one field:
    // the single-word searches do that.
    for (const [first, surname] of nameFields) {
      await expectResults(page, `${first} ${surname}`, {
        shown: [a.title, b.title],
        hidden: [d.title]
      })
    }
    await expectResults(
      page,
      `${names.a.motherFirst} ${names.a.motherSurname}`,
      { shown: [a.title], hidden: [b.title] }
    )

    // The name results show the row actions.
    await expectResultRowActions(page, names.a.childFirst, a.title)
  })

  await test.step('3.2 - A declaration from the name results opens', async () => {
    // This step searches again, so that it does not need the page that
    // step 3.1 left.
    await expectFoundAndOpen(page, names.a.childSurname, a.title)
  })

  await test.step('3.3 - A name that no record uses', async () => {
    await expectNoResults(page, t.unusedName)
  })

  await test.step('3.4 - A used name with special characters', async () => {
    for (const term of [
      `${names.a.childFirst}!`,
      `(${names.a.childFirst})`,
      `#${names.a.childFirst}`
    ]) {
      await expectResults(page, term, {
        shown: [a.title, b.title],
        hidden: [d.title]
      })
    }
  })

  await test.step('3 - Fuzzy rule (note) on TD-01 names', async () => {
    // More than 5 letters: 2 edits match TD-01. TD-02 and TD-04 are 3 or
    // more edits away.
    for (const term of [t.twoSwaps, t.twoSubstitutions]) {
      await expectResults(page, term, {
        shown: [a.title],
        hidden: [b.title, d.title]
      })
    }
    // 3-5 letters: 1 edit (a swap) matches TD-01.
    await expectResults(page, t.surnameEndSwap, { shown: [a.title] })
  })
})

// The checks are in expectResults().
// eslint-disable-next-line playwright/expect-expect
test(
  'Quick search: fuzzy rule on short names',
  { tag: ['@C2491'] },
  async ({ page }) => {
    const { names, c } =
      await test.step('Setup - Create the record TD-03', () =>
        createShortNameRecord())

    const t = names.terms

    await test.step('Setup - Wait until the record is in search, and log in as Local Registrar', async () => {
      await waitUntilSearchable([c])
      await loginAsLocalRegistrar(page)
    })

    await test.step('3 - Fuzzy rule (note) on short names', async () => {
      // More than 5 letters: 2 edits match. No word with 3 edits matches
      // (Elasticsearch allows at most 2 edits).
      for (const term of [t.motherSurnameTwoEdits, t.motherFirstPlusTwo]) {
        await expectResults(page, term, { shown: [c.title] })
      }
      await expectResults(page, t.motherSurnameThreeEdits, {
        hidden: [c.title]
      })

      // 3-5 letters: 1 edit matches, 2 edits do not.
      for (const term of [
        t.motherFirstOneEdit,
        t.motherFirstPlusOne,
        t.childFirstPlusOne
      ]) {
        await expectResults(page, term, { shown: [c.title] })
      }
      for (const term of [t.motherFirstTwoEdits, t.motherFirstFiveTwoEdits]) {
        await expectResults(page, term, { hidden: [c.title] })
      }

      // 1-2 letters: exact only.
      await expectResults(page, names.c.childFirst, { shown: [c.title] })
      await expectResults(page, t.childFirstOneEdit, { hidden: [c.title] })
    })
  }
)

test(
  'Quick search: extra checks (not in TestRail C2491)',
  { tag: ['@C2491'] },
  async ({ page }) => {
    // These checks are not in TestRail C2491. They need their own TestRail
    // case. Until then, they have the C2491 tag, so that they run with it.
    const { birth, death } =
      await test.step('Setup - Create a birth and a death record', () =>
        createExtraCheckRecords())

    await test.step('Setup - Wait until the records are in search, and log in as Local Registrar', async () => {
      await waitUntilSearchable([birth, death])
      await loginAsLocalRegistrar(page)
    })

    await test.step('Extra - Father and informant NIDs are searchable', async () => {
      for (const nid of [birth.fatherNid, birth.informantNid]) {
        await search(page, nid)
        await expect.soft(rowOf(page, birth.title)).toBeVisible()
      }
    })

    await test.step('Extra - Part of an NID does not match', async () => {
      await expectNoResults(page, birth.motherNid.slice(0, 9))
    })

    await test.step('Extra - Email search is not case-sensitive', async () => {
      await search(page, birth.email.toUpperCase(), 'icon')
      await expect.soft(rowOf(page, birth.title)).toBeVisible()
    })

    await test.step('Extra - A full name matches when one word matches, in birth and death records', async () => {
      await expectResults(page, `${birth.childFirst} ${death.surname}`, {
        shown: [birth.title, death.title]
      })
    })
  }
)
