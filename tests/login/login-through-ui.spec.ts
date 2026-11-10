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
import {
  CLIENT_URL,
  CREDENTIALS,
  LOGIN_URL,
  TEST_USER_PASSWORD
} from '@support/constants'
import { createPIN, ensureLoginPageReady } from '@support/helpers'
import { expect, test } from '@playwright/test'

test('Log in through the login app', async ({ page }) => {
  await test.step('Enter the username and password', async () => {
    await page.goto(LOGIN_URL)
    await ensureLoginPageReady(page)
    await page.locator('#username').fill(CREDENTIALS.REGISTRAR)
    await page.locator('#password').fill(TEST_USER_PASSWORD)
    await page.locator('#login-mobile-submit').click()
    await expect(page.locator('#login-step-two-box')).toBeVisible()
  })

  await test.step('Enter the 2FA code', async () => {
    await page.locator('#code').fill('000000')
    await page.locator('#login-mobile-submit').click()
    await expect(page).toHaveURL((url) => url.origin === CLIENT_URL)
  })

  await test.step('Create a PIN', async () => {
    await createPIN(page)
    // The first load installs the application, which can take 20 seconds.
    await expect(page.locator('#ProfileMenu-dropdownMenu')).toBeVisible({
      timeout: 30_000
    })
  })
})
