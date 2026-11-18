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
  createQuickSearchRecords,
  waitUntilSearchable
} from '@support/search/quick-search-records'

/** The longest time that the test waits for a search response. */
const SEARCH_RESULT_TIMEOUT = 30_000

/** How the search is sent: the Enter key, or a click on the search icon. */
type Submit = 'enter' | 'icon'

function rowOf(page: Page, title: string) {
  return page
    .locator('[id^="row_"]')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) })
}

/** Types the term in the search bar, sends it, and waits for the result page. */
async function search(page: Page, term: string, submit: Submit = 'enter') {
  const input = page.locator('#searchText')
  await input.fill(term)
  if (submit === 'enter') {
    await input.press('Enter')
  } else {
    await page.locator('#searchIconButton').click()
  }
  // The heading and the rows come from the same response, so the rows are
  // for this term when the heading shows it.
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
 * The row has 3 buttons: the record name, the primary action and the
 * download button ("Assign record"). The label of the primary action
 * changes with the status, so the test checks the other two by name and
 * the primary action as the third button.
 */
async function expectRowActions(row: Locator, title: string) {
  const buttons = row.getByRole('button')
  await expect(buttons).toHaveCount(3)
  await expect(
    row.getByRole('button', { name: title, exact: true })
  ).toBeVisible()
  await expect(row.getByRole('button', { name: 'Assign record' })).toBeVisible()
}

const MAX_RESULT_PAGES = 30

/**
 * Searches for the term once and returns which of the titles are in the
 * results, on any result page (10 rows on each page). Records from earlier
 * runs stay on the shared environment, so a record is not always on page 1.
 */
async function findInResults(page: Page, term: string, titles: string[]) {
  await search(page, term)
  await waitForResultPage(page, term)
  const found = new Set<string>()
  const rows = page.locator('[id^="row_"]')
  const next = page.locator('#next-page-button')
  for (let pageNumber = 1; pageNumber <= MAX_RESULT_PAGES; pageNumber++) {
    for (const title of titles) {
      if ((await rowOf(page, title).count()) > 0) found.add(title)
    }
    if (found.size === titles.length) return found
    if (!(await next.isVisible()) || (await next.isDisabled())) return found
    const firstRowId = await rows.first().getAttribute('id')
    await next.click()
    await expect(rows.first()).not.toHaveAttribute('id', firstRowId ?? '')
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
    expect(found.has(title), `${title} for "${term}"`).toBe(true)
  }
  for (const title of hidden) {
    expect(found.has(title), `${title} for "${term}"`).toBe(false)
  }
}

async function expectNoResults(
  page: Page,
  term: string,
  submit: Submit = 'enter'
) {
  await search(page, term, submit)
  await expect(page.getByText(`No results for “${term}”`)).toBeVisible()
}

/** Opens the record from its row and checks that its overview page opens. */
async function openFromResults(page: Page, title: string) {
  await openRecordByTitle(page, title)
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}(\?|$)/)
  // Go back to the result page. The search bar is there, and this is
  // faster than loading the app again.
  await page.goBack()
  await expect(page.locator('#searchText')).toBeVisible()
}

/** A valid search shows the record as a row with its actions, and opens it. */
async function expectFoundAndOpen(
  page: Page,
  term: string,
  title: string,
  submit: Submit = 'enter'
) {
  await search(page, term, submit)
  const row = rowOf(page, title)
  await expect(row).toBeVisible()
  await expectRowActions(row, title)
  await openFromResults(page, title)
}

test(
  'Quick search: tracking ID, name, registration number, NID, phone and email',
  { tag: ['@C2491'] },
  async ({ page }) => {
    const data = await test.step('Setup - Create the records', () =>
      createQuickSearchRecords())

    const { a, b, c, d, e, names } = data
    const t = names.terms

    await test.step('Setup - Wait until the records are in search, and log in as Local Registrar', async () => {
      // The API search uses the same index and jurisdiction rules as the
      // search bar. The search bar is only used in steps 1 to 8.
      await waitUntilSearchable([a, b, c, d, e])
      await login(page, CREDENTIALS.REGISTRAR)
      // The app loads its configuration after login. Wait until the search
      // bar is on the page, so that step 1 checks only its text.
      await expect(page.locator('#searchText')).toBeVisible({
        timeout: 30_000
      })
    })

    await test.step('1 - Search bar shows "Search for a record"', async () => {
      await expect(page.locator('#searchText')).toHaveAttribute(
        'placeholder',
        'Search for a record'
      )
    })

    await test.step('2 - Valid and invalid tracking ID', async () => {
      await expectFoundAndOpen(page, a.trackingId, a.title)
      await expectNoResults(page, changeLastCharacter(a.trackingId))
    })

    await test.step('3 - Name search with the fuzzy rule', async () => {
      // Each first name and surname is searched alone. Every name of TD-01
      // is at least 3 edits from its other names, so each search can find
      // TD-01 only through the field that it tests. TD-02 has a name 1 edit
      // away in the same field. TD-04 is 3 edits away in the child names.
      const nameFields: [string, string][] = [
        [names.a.childFirst, names.a.childSurname],
        [names.a.fatherFirst, names.a.fatherSurname],
        [names.a.informantFirst, names.a.informantSurname]
      ]
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
      // the single-word searches above do that.
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

      // Name results show the same row actions as the other searches.
      await search(page, names.a.childFirst)
      await expectRowActions(rowOf(page, a.title), a.title)

      // Click a declaration from the name results.
      await openFromResults(page, a.title)

      // A name that no record uses.
      await expectNoResults(page, t.unusedName)

      // A used name with special characters gives the same results.
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

      // Extra check (not in TestRail C2491): a full name matches when any
      // one word matches, also across event types (birth and death).
      await expectResults(page, `${names.a.childFirst} ${e.surname}`, {
        shown: [a.title, b.title, e.title]
      })

      // More than 5 letters: 2 edits match.
      for (const term of [t.twoSwaps, t.twoSubstitutions]) {
        await expectResults(page, term, {
          shown: [a.title],
          hidden: [b.title, d.title]
        })
      }
      for (const term of [t.motherSurnameTwoEdits, t.motherFirstPlusTwo]) {
        await expectResults(page, term, { shown: [c.title] })
      }

      // 3 to 5 letters: 1 edit matches, 2 edits do not.
      await expectResults(page, t.surnameEndSwap, { shown: [a.title] })
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

      // 1 or 2 letters: exact only.
      await expectResults(page, names.c.childFirst, { shown: [c.title] })
      await expectResults(page, t.childFirstOneEdit, { hidden: [c.title] })
    })

    await test.step('4 - Valid and invalid registration number', async () => {
      expect(a.registrationNumber).toBeDefined()
      const registrationNumber = a.registrationNumber as string
      await expectFoundAndOpen(page, registrationNumber, a.title)
      await expectNoResults(page, changeLastCharacter(registrationNumber))
    })

    await test.step('5 - Valid and invalid NID', async () => {
      await expectFoundAndOpen(page, a.motherNid, a.title)
      await expectNoResults(page, changeLastCharacter(a.motherNid))

      // Extra checks (not in TestRail C2491): the father and informant NIDs
      // are also searchable, and part of an NID does not match.
      for (const nid of [a.fatherNid, a.informantNid]) {
        await search(page, nid)
        await expect(rowOf(page, a.title)).toBeVisible()
      }
      await expectNoResults(page, a.motherNid.slice(0, 9))
    })

    await test.step('6 - Valid and invalid phone number', async () => {
      // Quick search matches phone numbers directly.
      // TestRail says "Click Search", so this step clicks the search icon.
      await expectFoundAndOpen(page, a.phone, a.title, 'icon')
      await expectNoResults(page, changeLastCharacter(a.phone), 'icon')
    })

    await test.step('7 - Valid and invalid email', async () => {
      // Quick search matches emails directly.
      // TestRail says "Click Search", so this step clicks the search icon.
      await expectFoundAndOpen(page, a.email, a.title, 'icon')
      await expectNoResults(page, a.email.replace(/\.com$/, '.co'), 'icon')

      //Invalid email that no record uses.
      const randomEmail = `${faker.string.alpha({ length: 10, casing: 'lower' })}@example.com`
      await expectNoResults(page, randomEmail, 'icon')

      // Extra check (not in TestRail C2491): email search is not
      // case-sensitive.
      await search(page, a.email.toUpperCase(), 'icon')
      await expect(rowOf(page, a.title)).toBeVisible()
    })

    await test.step('8 - Advanced Search button opens Advanced Search', async () => {
      await page.locator('#searchType').click()
      await expect(page).toHaveURL(/.*\/advanced-search/)
    })
  }
)
