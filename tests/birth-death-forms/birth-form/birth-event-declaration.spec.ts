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
import { expect, test, type Page } from '@playwright/test'
import { faker } from '@faker-js/faker'
import { format, subDays } from 'date-fns'
import {
  formatDateObjectTo_dMMMMyyyy,
  getToken,
  joinValuesWith,
  login,
  triggerDeclarationAction,
  waitForActionResponses
} from '@support/helpers'
import { CREDENTIALS } from '@support/constants'
import {
  assertRecordInWorkqueue,
  fillDate,
  REQUIRED_VALIDATION_ERROR
} from '@support/birth/helpers'
import { clickWorkqueueActionByTitle } from '@support/print-certificate/birth/helpers'
import { createBirthDraftViaApi } from '@support/test-data/api-actions'

// A new form first has a temporary id (`tmp-...`). The app replaces it with
// the event id when the server creates the event, so match the route, not
// the id.
const DECLARATION_FORM_URL = /\/events\/declare\//
const CHILD_DETAILS_URL = /\/events\/declare\/[^/]+\/pages\/child/

function makeDeclaration() {
  const dob = subDays(new Date(), 30)

  return {
    child: {
      firstname: faker.person.firstName('male'),
      surname: faker.person.lastName(),
      gender: 'Male',
      dob: {
        dd: format(dob, 'dd'),
        mm: format(dob, 'MM'),
        yyyy: format(dob, 'yyyy')
      },
      placeOfBirth: 'Health Institution',
      birthLocation: 'Ibombo District Hospital'
    },
    informant: {
      relation: 'Mother',
      email: faker.internet.email()
    }
  }
}

async function openEventSelection(page: Page) {
  await page.locator('#header-new-event').click()
  await expect(
    page.getByText('What type of event do you want to declare?')
  ).toBeVisible()
}

async function startBirthDeclaration(page: Page) {
  await openEventSelection(page)
  await page.getByLabel('Birth').click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByText('Introduce the birth registration process to the informant')
  ).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText("Child's details", { exact: true })).toBeVisible()
}

async function expectFormPageButtons(page: Page) {
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Go to review' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Exit', exact: true })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save & Exit' })).toBeVisible()

  await page.locator('#event-menu-dropdownMenu').click()
  await expect(
    page
      .locator('#event-menu-dropdownMenu')
      .getByRole('listitem')
      .filter({ hasText: 'Delete draft' })
  ).toBeVisible()
  // Close the menu.
  await page.keyboard.press('Escape')
}

type Declaration = ReturnType<typeof makeDeclaration>

async function fillChildName(
  page: Page,
  child: { firstname: string; surname: string }
) {
  await page.locator('#firstname').fill(child.firstname)
  await page.locator('#surname').fill(child.surname)
}

async function fillChildDetails(page: Page, child: Declaration['child']) {
  await fillChildName(page, child)
  await page.locator('#child____gender').click()
  await page.getByText(child.gender, { exact: true }).click()
  await fillDate(page, child.dob)
  await page.locator('#child____placeOfBirth').click()
  await page.getByText(child.placeOfBirth, { exact: true }).click()
  await page
    .locator('#child____birthLocation')
    .fill(child.birthLocation.slice(0, 3))
  await page.getByText(child.birthLocation, { exact: true }).click()
}

async function expectSaveAndExitModal(page: Page) {
  await expect(
    page.getByRole('heading', { name: 'Save & exit?' })
  ).toBeVisible()
  await expect(
    page.getByText(
      'All inputted data will be kept secure for future editing. Are you ready to save any changes to this declaration form?'
    )
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible()
}

/**
 * Opens the draft from "Drafts" with "Update". Then checks that the Review
 * page shows the child's details that the test entered before "Save & Exit".
 */
async function expectDraftHasChildDetails(
  page: Page,
  childName: string,
  child: Declaration['child']
) {
  await assertRecordInWorkqueue({
    page,
    name: childName,
    workqueues: [{ title: 'Drafts', exists: true }]
  })
  await clickWorkqueueActionByTitle(page, childName, 'Update')
  await expect(page).toHaveURL(/\/review/)

  await expect(page.getByTestId('child.name-value')).toContainText(childName)
  await expect(page.getByTestId('child.gender-value')).toContainText(
    child.gender
  )
  await expect(page.getByTestId('child.dob-value')).toContainText(
    formatDateObjectTo_dMMMMyyyy(child.dob)
  )
  await expect(page.getByTestId('child.placeOfBirth-value')).toContainText(
    child.placeOfBirth
  )
  await expect(page.getByTestId('child.birthLocation-value')).toContainText(
    child.birthLocation
  )
}

/**
 * Checks that `childName` is not in Drafts. The Drafts title shows before its
 * rows load, so an absence check alone passes at once. The control draft is
 * found first, which proves that the list has loaded.
 */
async function expectNotInDrafts(
  page: Page,
  controlDraftName: string,
  childName: string
) {
  await assertRecordInWorkqueue({
    page,
    name: controlDraftName,
    workqueues: [{ title: 'Drafts', exists: true }]
  })
  await expect(
    page.getByRole('button', { name: childName, exact: true })
  ).toBeHidden()
}

test(
  'Walk through the form and save a draft',
  { tag: ['@C3398'] },
  async ({ page }) => {
    const declaration = makeDeclaration()
    const childName = joinValuesWith([
      declaration.child.firstname,
      declaration.child.surname
    ])

    await test.step('Setup: Log in as the registrar', async () => {
      await login(page, CREDENTIALS.REGISTRAR)
    })

    await test.step('1. Click the + (Plus) sign', async () => {
      await openEventSelection(page)
    })

    await test.step('2. Validate the event selection page', async () => {
      await expect(page.getByLabel('Birth')).toBeVisible()
      await expect(page.getByLabel('Death')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Exit', exact: true })
      ).toBeVisible()

      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(
        page.getByText('Please select the type of event')
      ).toBeVisible()

      await page.getByLabel('Birth').click()
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(
        page.getByText(
          'Introduce the birth registration process to the informant'
        )
      ).toBeVisible()
    })

    await test.step('3. Validate the "Introduction" page', async () => {
      await expectFormPageButtons(page)

      for (const text of [
        'I am going to help you make a declaration of birth.',
        'As the legal Informant it is important that all the information provided by you is accurate.',
        // TestRail has the typo "you will receive you will receive". The UI
        // has the text below.
        'Once the declaration is processed you will receive an SMS to tell you when to visit the office to collect the certificate - Take your ID with you.',
        'Make sure you collect the certificate. A birth certificate is critical for this child, especially to make their life easy later on. It will help to access health services, school examinations and government benefits.'
      ]) {
        await expect(page.getByText(text)).toBeVisible()
      }

      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(
        page.getByText("Child's details", { exact: true })
      ).toBeVisible()
    })

    await test.step('4. Validate the "Child details" page', async () => {
      // Expected result 2 (the fields of the page) is covered by the
      // TestRail case "Validate Child's details page".
      await expectFormPageButtons(page)

      await fillChildDetails(page, declaration.child)

      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(
        page.getByText("Informant's details", { exact: true })
      ).toBeVisible()
    })

    await test.step('5. Validate the "Informant details" page', async () => {
      // Expected result 2 (the fields of the page) is covered by the
      // TestRail case "Validate Informant's details page when informant is
      // not father/ mother".
      await expectFormPageButtons(page)
      await expect(page.locator('#informant____relation')).toBeVisible()

      await page.locator('#informant____relation').click()
      await page
        .getByText(declaration.informant.relation, { exact: true })
        .click()

      await expect(page.locator('#informant____phoneNo')).toBeVisible()
      await expect(page.locator('#informant____email')).toBeVisible()
      await page
        .locator('#informant____email')
        .fill(declaration.informant.email)

      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(
        page.getByText("Mother's details", { exact: true })
      ).toBeVisible()
    })

    await test.step('6. Validate the "Mother details" page', async () => {
      // Expected result 2 (the fields of the page) is covered by the
      // TestRail case "Validate Mother's details page".
      await expectFormPageButtons(page)
      await expect(page.locator('#mother____idType')).toBeVisible()

      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(
        page.getByText("Father's details", { exact: true })
      ).toBeVisible()
    })

    await test.step('7. Validate the "Father details" page', async () => {
      // Expected result 2 (the fields of the page) is covered by the
      // TestRail case "Validate Father's details page".
      await expectFormPageButtons(page)
      await expect(page.locator('#father____idType')).toBeVisible()

      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(
        page.getByText('Upload supporting documents', { exact: true })
      ).toBeVisible()
    })

    await test.step('8. Validate the "Supporting document" page', async () => {
      // The document block is the "Upload supporting documents" page that
      // step 7 checks. Expected result 2 (the upload controls) is covered by
      // the TestRail case "Validate Supporting documents page".
      await expectFormPageButtons(page)

      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(page).toHaveURL(/\/review/)
    })

    await test.step('10. Validate the "Review" page', async () => {
      // Expected result 2 (the review block) is covered by the TestRail case
      // "Validate declaration review page".
      await expect(page.getByTestId('child.name-value')).toContainText(
        childName
      )

      // The attached file viewer. The test did not attach a file, so the
      // viewer has no dropdown of files. The test does not check the dropdown.
      await expect(page.getByText('No supporting documents')).toBeVisible()
      // The (X) button to exit without saving.
      await expect(page.getByTestId('exit-button')).toBeVisible()

      // The registrar has the scopes to declare and to register. The test
      // does not check Notify, because the registrar does not have it.
      // TestRail has "Delete declaration". The UI has "Delete draft".
      await page.getByRole('button', { name: 'Action', exact: true }).click()
      for (const action of [
        'Register',
        'Declare',
        'Save & Exit',
        'Delete draft'
      ]) {
        await expect(page.getByText(action, { exact: true })).toBeVisible()
      }
      await page.getByRole('button', { name: 'Action', exact: true }).click()
    })

    // This test uses "Save & Exit" in the action menu of the Review page. The
    // test '"Save & Exit" on a form page keeps the data' uses the button on
    // a form page.
    await test.step('11. Validate "Save & Exit"', async () => {
      await page.getByRole('button', { name: 'Action', exact: true }).click()
      await page.getByText('Save & Exit', { exact: true }).click()
      await expectSaveAndExitModal(page)

      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect(
        page.getByRole('heading', { name: 'Save & exit?' })
      ).toBeHidden()

      await triggerDeclarationAction(page, 'Save & Exit')

      await expect(page).not.toHaveURL(DECLARATION_FORM_URL)
      await expectDraftHasChildDetails(page, childName, declaration.child)
      await expect(page.getByTestId('informant.relation-value')).toContainText(
        declaration.informant.relation
      )
      await expect(page.getByTestId('informant.email-value')).toContainText(
        declaration.informant.email
      )
    })
  }
)

// The steps run in the order 11.1, 11.3, 11.2: "Cancel" must run while the
// form is still open, before "Confirm" closes it.
test(
  '"Save & Exit" on a form page keeps the data',
  { tag: ['@C3398'] },
  async ({ page }) => {
    const declaration = makeDeclaration()
    const childName = joinValuesWith([
      declaration.child.firstname,
      declaration.child.surname
    ])

    await test.step('Setup: Log in and fill the "Child details" page', async () => {
      await login(page, CREDENTIALS.REGISTRAR)
      await startBirthDeclaration(page)
      await fillChildDetails(page, declaration.child)
    })

    await test.step('11.1 Click "Save & Exit" on the "Child details" page', async () => {
      await page.getByRole('button', { name: 'Save & Exit' }).click()
      await expectSaveAndExitModal(page)
    })

    await test.step('11.3 Click "Cancel" (run before 11.2)', async () => {
      await page.getByRole('button', { name: 'Cancel' }).click()

      await expect(
        page.getByRole('heading', { name: 'Save & exit?' })
      ).toBeHidden()
      await expect(page).toHaveURL(CHILD_DETAILS_URL)
      await expect(page.locator('#firstname')).toHaveValue(
        declaration.child.firstname
      )
    })

    await test.step('11.2 Click "Confirm"', async () => {
      await page.getByRole('button', { name: 'Save & Exit' }).click()
      await waitForActionResponses(page, ['event.draft.create'], async () => {
        await page.getByRole('button', { name: 'Confirm' }).click()
      })

      await expect(page).not.toHaveURL(DECLARATION_FORM_URL)
      await expectDraftHasChildDetails(page, childName, declaration.child)
    })
  }
)

test(
  '"Go to review" shows the untouched required fields',
  { tag: ['@C3398'] },
  async ({ page }) => {
    const declaration = makeDeclaration()

    await test.step('Setup: Log in and open a birth declaration', async () => {
      await login(page, CREDENTIALS.REGISTRAR)
      await startBirthDeclaration(page)
      await fillChildName(page, declaration.child)
    })

    await test.step('9. Click "Go to review"', async () => {
      await page.getByRole('button', { name: 'Go to review' }).click()

      await expect(page).toHaveURL(/\/review/)
      await expect(page.getByTestId('child.name-value')).toContainText(
        declaration.child.firstname
      )
      // The child's sex is a required field that the test did not fill.
      // The test checks the "Required" text. It does not check the red
      // colour, because a colour check depends on the CSS of the page.
      await expect(page.getByTestId('child.gender-value')).toHaveText(
        REQUIRED_VALIDATION_ERROR
      )
    })
  }
)

// The steps run in the order 12.1, 12.3, 12.2: "Cancel" must run while the
// form is still open, before "Confirm" closes it.
test(
  '"Exit" closes the form without saving',
  { tag: ['@C3398'] },
  async ({ page }) => {
    const declaration = makeDeclaration()
    const childName = joinValuesWith([
      declaration.child.firstname,
      declaration.child.surname
    ])
    const modalTitle = page.getByRole('heading', {
      name: 'Exit without saving changes?'
    })
    let controlDraftName = ''

    await test.step('Setup: Create a control draft, log in and fill the child name', async () => {
      controlDraftName = await createBirthDraftViaApi(
        await getToken(CREDENTIALS.REGISTRAR)
      )
      await login(page, CREDENTIALS.REGISTRAR)
      await startBirthDeclaration(page)
      await fillChildName(page, declaration.child)
    })

    await test.step('12.1 Click "Exit"', async () => {
      await page.getByRole('button', { name: 'Exit', exact: true }).click()

      await expect(modalTitle).toBeVisible()
      await expect(
        page.getByText(
          'You have unsaved changes on your declaration form. Are you sure you want to exit without saving?'
        )
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible()
    })

    await test.step('12.3 Click "Cancel" (run before 12.2)', async () => {
      await page.getByRole('button', { name: 'Cancel' }).click()

      await expect(modalTitle).toBeHidden()
      await expect(page).toHaveURL(CHILD_DETAILS_URL)
      await expect(
        page.getByText("Child's details", { exact: true })
      ).toBeVisible()
    })

    await test.step('12.2 Click "Confirm"', async () => {
      await page.getByRole('button', { name: 'Exit', exact: true }).click()
      await page.getByRole('button', { name: 'Confirm' }).click()

      await expect(page).not.toHaveURL(DECLARATION_FORM_URL)
      await expect(
        page.getByText("Child's details", { exact: true })
      ).toBeHidden()
      await expectNotInDrafts(page, controlDraftName, childName)
    })
  }
)

// The steps run in the order 13.1, 13.3, 13.2: "Cancel" must run while the
// form is still open, before "Confirm" deletes the draft.
test('"Delete draft"', { tag: ['@C3398'] }, async ({ page }) => {
  const declaration = makeDeclaration()
  const childName = joinValuesWith([
    declaration.child.firstname,
    declaration.child.surname
  ])
  const modalTitle = page.getByRole('heading', { name: 'Delete draft?' })
  let controlDraftName = ''

  async function clickDeleteDeclaration() {
    await page.locator('#event-menu-dropdownMenu').click()
    await page
      .locator('#event-menu-dropdownMenu')
      .getByRole('listitem')
      .filter({ hasText: 'Delete draft' })
      .click()
  }

  await test.step('Setup: Create a control draft, log in and fill the child name', async () => {
    controlDraftName = await createBirthDraftViaApi(
      await getToken(CREDENTIALS.REGISTRAR)
    )
    await login(page, CREDENTIALS.REGISTRAR)
    await startBirthDeclaration(page)
    await fillChildName(page, declaration.child)
  })

  await test.step('13.1 Click the 3-dot menu > "Delete draft"', async () => {
    await clickDeleteDeclaration()

    await expect(modalTitle).toBeVisible()
    await expect(
      // TestRail has "this declaration". The UI has "this draft".
      page.getByText('Are you sure you want to delete this draft?')
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible()
  })

  await test.step('13.3 Click "Cancel" (run before 13.2)', async () => {
    await page.getByRole('button', { name: 'Cancel' }).click()

    await expect(modalTitle).toBeHidden()
    await expect(page).toHaveURL(CHILD_DETAILS_URL)
    await expect(
      page.getByText("Child's details", { exact: true })
    ).toBeVisible()
  })

  await test.step('13.2 Click "Confirm"', async () => {
    await clickDeleteDeclaration()
    // The server must confirm the delete. Without this wait, the check
    // below would pass even if the delete did nothing.
    await waitForActionResponses(page, ['event.delete'], async () => {
      await page.getByRole('button', { name: 'Confirm' }).click()
    })

    await expect(page).not.toHaveURL(DECLARATION_FORM_URL)
    await expect(
      page.getByText("Child's details", { exact: true })
    ).toBeHidden()
    await expectNotInDrafts(page, controlDraftName, childName)
  })
})
