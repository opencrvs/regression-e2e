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
import { test, expect, type Browser, type Page } from '@playwright/test'
import { v4 as uuidv4 } from 'uuid'
import { faker } from '@faker-js/faker'
import { createClient } from '@opencrvs/toolkit/api'
import { getToken, login, ensureLoginPageReady } from '@support/helpers'
import { CREDENTIALS, LOGIN_URL, GATEWAY_HOST } from '@support/constants'
import { getAdministrativeAreas, getIdByName } from '@support/birth/helpers'
import { fetchClientAPI } from '@support/events-rest-api/helpers'
import { getExpectedUsername } from '@support/test-data/api-actions'

/*
 * The test creates its own office and user through the location API. It does
 * not change the seeded Farajaland offices, because other tests use them.
 */

async function createOffice(
  systemAdminToken: string,
  administrativeAreaId: string,
  name: string
) {
  const payload = {
    id: uuidv4(),
    name,
    externalId: `e2e-${uuidv4()}`,
    administrativeAreaId,
    locationType: 'CRVS_OFFICE'
  }

  const response = await fetchClientAPI(
    '/api/events/locations',
    'POST',
    systemAdminToken,
    payload
  )
  expect(response.status).toBe(200)
  return response.json()
}

async function putLocationVersion(
  systemAdminToken: string,
  locationId: string,
  body: {
    name: string
    externalId: string | null
    status: 'active' | 'inactive'
    effectiveFrom: string
    lastVersionId: string
  }
) {
  const response = await fetchClientAPI(
    `/api/events/locations/${locationId}`,
    'PUT',
    systemAdminToken,
    body
  )
  expect(response.status).toBe(200)
  return response.json()
}

// `role` is the API role id (e.g. 'REGISTRATION_AGENT'), not the display label.
async function provisionUserInOffice(
  systemAdminToken: string,
  officeId: string,
  role: string
) {
  const firstname = faker.person.firstName('female')
  const surname = faker.person.lastName('female')
  const username = getExpectedUsername({ firstname, surname })
  const fullname = `${firstname} ${surname}`

  const client = createClient(
    GATEWAY_HOST + '/events',
    `Bearer ${systemAdminToken}`
  )
  await client.user.create.mutate({
    name: { firstname, surname },
    role,
    primaryOfficeId: officeId,
    mobile: '07' + faker.string.numeric(8),
    email: faker.internet.email().toLowerCase(),
    fullHonorificName: fullname,
    device: faker.phone.imei(),
    data: {}
  })

  return { username, fullname }
}

test.describe('Jurisdiction & routing under location versioning', () => {
  let systemAdminToken: string
  let ibomboAreaId: string
  let openPages: Page[] = []

  async function newPage(browser: Browser) {
    const page = await browser.newPage()
    openPages.push(page)
    return page
  }

  test.beforeAll(async () => {
    systemAdminToken = await getToken(CREDENTIALS.NATIONAL_SYSTEM_ADMIN)
    const administrativeAreas = await getAdministrativeAreas(systemAdminToken)
    ibomboAreaId = getIdByName(administrativeAreas, 'Ibombo')
  })

  // Extra pages from newPage() don't auto-close and pile up across this serial run.
  test.afterEach(async () => {
    await Promise.all(openPages.map((page) => page.close().catch(() => {})))
    openPages = []
  })

  test(
    'User is not auto-reassigned but is locked out from login when their office is inactivated',
    { tag: ['@C3431', '@C3460'] },
    async ({ browser }) => {
      const officeName = `E2E No-Reassign Office ${uuidv4()}`
      const office = await createOffice(
        systemAdminToken,
        ibomboAreaId,
        officeName
      )

      const { username, fullname } = await provisionUserInOffice(
        systemAdminToken,
        office.id,
        'REGISTRATION_AGENT'
      )

      // The office picker excludes inactive offices from search, so select it
      // before inactivating (see Team.OfficeActiveOnly.interaction.stories.tsx).
      const adminPage = await newPage(browser)
      await login(adminPage, CREDENTIALS.LOCAL_SYSTEM_ADMIN)
      await adminPage.getByRole('button', { name: 'Team' }).click()
      await adminPage
        .getByRole('button', { name: /Office/ })
        .first()
        .click()
      await adminPage.getByTestId('locationSearchInput').fill(officeName)
      await adminPage.getByText(new RegExp(officeName)).first().click()

      await putLocationVersion(systemAdminToken, office.id, {
        name: office.name,
        externalId: office.externalId,
        status: 'inactive',
        effectiveFrom: '2020-06-01',
        lastVersionId: office.versions[0].versionId
      })

      // Existing user-management reassignment is a manual, separate action —
      // inactivating the office must not silently move this user elsewhere.
      await adminPage.reload()
      await adminPage.getByRole('button', { name: fullname }).click()
      await adminPage
        .locator('#sub-page-header-munu-button-dropdownMenu')
        .click()
      await adminPage.getByText('Edit details').click()
      await expect(
        adminPage.getByTestId('primaryOfficeId-value')
      ).toContainText(officeName)

      // The office check runs before user status, so even a still-'pending'
      // account is locked out at first login rather than reaching the ceremony.
      const firstLoginPage = await newPage(browser)
      await firstLoginPage.goto(LOGIN_URL)
      await ensureLoginPageReady(firstLoginPage)
      await firstLoginPage.fill('#username', username)
      await firstLoginPage.fill('#password', 'test')
      await firstLoginPage.click('#login-mobile-submit')
      await expect(
        firstLoginPage.getByText(
          'Your assigned office has been made inactive. Please contact your administrator to be reassigned'
        )
      ).toBeVisible()
    }
  )
})
