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
import { openRecordByTitle } from '@support/print-certificate/birth/helpers'
import {
  changeLastCharacter,
  createFullNameRecords,
  invalidId,
  createIdRecord,
  createNameRecords,
  createShortNameRecord,
  waitUntilSearchable
} from '../quick-search-records'

/*
 * TestRail C2491 "Validate quick search options" is split into tests by the
 * records that they need. Each test creates its own records.
 *
 * | Test                                    | C2491 steps             |
 * | Search bar text and Advanced Search     | 1, 8                    |
 * | Search by ID, phone and email           | 2, 4, 5, 6, 7           |
 * | Search by name                          | 3.1-3.4, fuzzy on TD-01 |
 * | Fuzzy rule on short names               | 3 (fuzzy on TD-03)      |
 * | Full name across birth and death        | 9                       |
 *
 * The checks of an expected result are soft (expect.soft): a failed check
 * is reported, and the test continues with the next check and step. The
 * test still fails at the end. The waits that the later checks need (login,
 * records, search result page, result pages) are hard and stop the test.
 */

/** How the search is sent: the Enter key, or a click on the search icon. */
type Submit = 'enter' | 'icon'

/** A record that the test opens: its title in the results and its tracking ID. */
type OpenableRecord = { title: string; trackingId: string }

/**
 * The row of the record in the result list. The rows have no role and no
 * test ID. Each row has the id row_0, row_1, and so on.
 */
function rowOf(page: Page, title: string) {
  return page
    .locator('[id^="row_"]')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) })
}

/**
 * Starts to wait for the search response. The client sends the term in
 * the body of an event.search request. Call this before the search is sent.
 */
function waitForSearchResponse(page: Page, term: string, offset?: number) {
  const termInBody = `"term":${JSON.stringify(term)}`
  return page.waitForResponse((response) => {
    const request = response.request()
    const body = request.postData() ?? ''
    return (
      request.method() === 'POST' &&
      response.url().includes('event.search') &&
      body.includes(termInBody) &&
      (offset === undefined || body.includes(`"offset":${offset}`))
    )
  })
}

/** Types the term in the search bar, sends it, and waits for the result page. */
async function search(page: Page, term: string, submit: Submit = 'enter') {
  // The client does not send the search again when the page already shows
  // the same term, so the response wait would not end.
  if (new URL(page.url()).searchParams.get('term') === term) {
    throw new Error(
      `The page already shows "${term}". Search for another term first.`
    )
  }
  const input = page.locator('#searchText')
  await input.fill(term)
  const searchResponse = waitForSearchResponse(page, term)
  if (submit === 'enter') {
    await input.press('Enter')
  } else {
    await page.locator('#searchIconButton').click()
  }
  // The search is sent: the address shows the new term.
  await expect(page, `The search for "${term}" was not sent`).toHaveURL(
    (url) => url.searchParams.get('term') === term
  )
  await searchResponse
  // The page shows the previous results until the new results are ready.
  // The heading and the rows come from the same response, so the rows are
  // for this term when the heading shows it.
  await expect(page.locator('#content-name')).toHaveText(
    `Search result for “${term}”`
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
 * The row shows the record name, the primary action and the download
 * button ("Assign record"). The label of the primary action changes with
 * the status, so the test checks only the name and the download button.
 */
async function expectRowActions(row: Locator, title: string) {
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
 * `onRow` runs for each title that the test finds, while its page shows.
 */
async function findInResults(
  page: Page,
  term: string,
  titles: string[],
  submit: Submit = 'enter',
  onRow?: (row: Locator, title: string) => Promise<void>
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
    // These checks do not retry, and they do not have to. The test waited
    // for the search response and for the heading or the new first row,
    // and the rows come in the same render. A "not shown" check also
    // cannot wait for a row to be absent.
    for (const title of titles) {
      if (found.has(title)) continue
      if ((await rowOf(page, title).count()) > 0) {
        found.add(title)
        await onRow?.(rowOf(page, title), title)
      }
    }
    if (found.size === titles.length) return found
    if (!(await next.isVisible()) || (await next.isDisabled())) return found
    // Each page numbers its rows from row_0, so the test waits for the
    // offset in the address and for a different record in the first row.
    const offset = pageNumber * RESULTS_PER_PAGE
    const previousFirstTitle = (await firstTitle.textContent()) ?? ''
    const pageResponse = waitForSearchResponse(page, term, offset)
    await next.click()
    await expect(page).toHaveURL(
      (url) => url.searchParams.get('offset') === String(offset)
    )
    await pageResponse
    await expect(firstTitle).not.toHaveText(previousFirstTitle)
  }
  throw new Error(
    `"${term}" has more than ${MAX_RESULT_PAGES} result pages. Use a rarer name.`
  )
}

/**
 * Searches for the term once. Each record in `shown` must be in the
 * results. Each record in `hidden` must not be in the results. With
 * `rowActions`, the test also checks the buttons of each `shown` row.
 */
async function expectResults(
  page: Page,
  term: string,
  {
    shown = [],
    hidden = [],
    submit = 'enter',
    rowActions = false
  }: {
    shown?: string[]
    hidden?: string[]
    submit?: Submit
    rowActions?: boolean
  }
) {
  const found = await findInResults(
    page,
    term,
    [...shown, ...hidden],
    submit,
    async (row, title) => {
      if (rowActions && shown.includes(title)) {
        await expectRowActions(row, title)
      }
    }
  )
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

/**
 * Opens the record from the result list, checks that its summary page
 * opens, and goes back to the result list.
 */
async function openFromResults(page: Page, record: OpenableRecord) {
  await openRecordByTitle(page, record.title)
  await expect
    .soft(page.getByTestId('tracking-id-value'), `Summary of ${record.title}`)
    .toHaveText(record.trackingId)
  // Go back to the result page. This is faster than loading the app again.
  await page.goBack()
  await expect(page).toHaveURL((url) => url.searchParams.has('term'))
}

/** A valid search shows the record as a row with its actions, and opens it. */
async function expectFoundAndOpen(
  page: Page,
  term: string,
  record: OpenableRecord,
  submit: Submit = 'enter'
) {
  // Quick search also searches the word as a fuzzy name, so other records
  // can be in the results. The record is not always on page 1.
  const row = await goToResultRow(page, term, record.title, submit)
  if (!row) return
  await expectRowActions(row, record.title)
  await openFromResults(page, record)
}

/** Logs in as the Local Registrar and waits until the search bar is on the page. */
async function loginAsLocalRegistrar(page: Page) {
  await login(page, CREDENTIALS.REGISTRAR)
  // The app loads its configuration and the workqueues after login. This
  // takes more than 5 seconds, which is longer than the time limit of
  // expect(). waitFor() is an action wait, like the wait of fill() or
  // click(). It has no time limit other than the test timeout.
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

// The checks are in expectFoundAndOpen(), expectResults() and
// expectNoResults().
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
      await expectFoundAndOpen(page, record.trackingId, record)
      await expectNoResults(page, invalidId(record.trackingId))
    })

    await test.step('4 - Valid and invalid registration number', async () => {
      await expectFoundAndOpen(page, record.registrationNumber, record)
      await expectNoResults(page, invalidId(record.registrationNumber))
    })

    await test.step('5 - Valid, invalid and partial NID', async () => {
      // 5.1 and 5.2: mother NID.
      await expectFoundAndOpen(page, record.motherNid, record)
      // 5.3: father NID and informant NID of the same record.
      for (const nid of [record.fatherNid, record.informantNid]) {
        await expectResults(page, nid, { shown: [record.title] })
      }
      // 5.4: invalid NID.
      await expectNoResults(page, changeLastCharacter(record.motherNid))
      // 5.5: the first 9 digits of a valid NID.
      await expectNoResults(page, record.motherNid.slice(0, 9))
    })

    await test.step('6 - Valid and invalid phone number', async () => {
      // Quick search matches phone numbers directly.
      // TestRail says "Click Search", so this step clicks the search icon.
      await expectFoundAndOpen(page, record.phone, record, 'icon')
      await expectNoResults(page, changeLastCharacter(record.phone), 'icon')
    })

    await test.step('7 - Valid, capital-letter and invalid email', async () => {
      // TestRail says "Click Search", so this step clicks the search icon.
      // 7.1 and 7.2: valid email.
      await expectFoundAndOpen(page, record.email, record, 'icon')
      // 7.3: the same email in capital letters. Email search is not
      // case-sensitive.
      await expectResults(page, record.email.toUpperCase(), {
        shown: [record.title],
        submit: 'icon'
      })
      // 7.4: invalid email 1 character away from the valid one. Email
      // search must be an exact match.
      await expectNoResults(page, record.email.replace(/\.com$/, '.co'), 'icon')
      // 7.4: invalid email that no record uses.
      const randomEmail = `${faker.string.alpha({ length: 10, casing: 'lower' })}@example.com`
      await expectNoResults(page, randomEmail, 'icon')
    })
  }
)

// The checks are in expectFoundAndOpen(), expectResults() and
// expectNoResults().
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
    // First names and surnames: TD-01 and TD-02, not TD-04. The rows show
    // their actions.
    for (const [first, surname] of nameFields) {
      for (const term of [first, surname]) {
        await expectResults(page, term, {
          shown: [a.title, b.title],
          hidden: [d.title],
          rowActions: true
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
  })

  await test.step('3.2 - A declaration from the name results opens', async () => {
    // This step searches again, so that it does not need the page that
    // step 3.1 left.
    await expectFoundAndOpen(page, names.a.childSurname, a)
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

// The checks are in expectResults().
// eslint-disable-next-line playwright/expect-expect
test(
  'Quick search: full name across birth and death records',
  { tag: ['@C2491'] },
  async ({ page }) => {
    const { birth, death } =
      await test.step('Setup - Create a birth and a death record', () =>
        createFullNameRecords())

    await test.step('Setup - Wait until the records are in search, and log in as Local Registrar', async () => {
      await waitUntilSearchable([birth, death])
      await loginAsLocalRegistrar(page)
    })

    await test.step('9 - A full name matches when one word matches', async () => {
      await expectResults(page, `${birth.childFirst} ${death.surname}`, {
        shown: [birth.title, death.title],
        rowActions: true
      })
    })
  }
)
