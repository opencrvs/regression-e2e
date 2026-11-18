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
import { addDays, format, subDays } from 'date-fns'
import { formatDateObjectTo_dMMMMyyyy, login } from '@support/helpers'
import { CREDENTIALS } from '@support/constants'
import {
  fillDate,
  openBirthDeclaration,
  REQUIRED_VALIDATION_ERROR
} from '@support/birth/helpers'
import { selectLocationOption, type } from '@support/utils'

// The country config shows "Reason for delayed registration" when the child
// is older than this number of days.
const LATE_REGISTRATION_DAYS = 365

type DateParts = { dd: string; mm: string; yyyy: string }

function toDateParts(date: Date): DateParts {
  return {
    dd: format(date, 'dd'),
    mm: format(date, 'MM'),
    yyyy: format(date, 'yyyy')
  }
}

/** All the values that the tests enter and expect, in one place. */
const child = {
  names: {
    // TestRail steps 1.1 and 2.1, in the TestRail order.
    withNumber: 'Richard the 3rd',
    withHyphen: 'John-Peter',
    // The field shows an error for this name.
    invalid: 'John_Peter',
    withApostrophe: "O'Neill",
    invalidError:
      "Input contains invalid characters. Please use only letters (a-z, A-Z), numbers (0-9), hyphens (-) and apostrophes(')",
    valid: faker.person.firstName(),
    // The field accepts a maximum of 32 characters. The test uses exactly 32
    // characters, the largest number that is less than 33.
    lessThan33Characters: faker.string.alpha(32),
    moreThan32Characters: faker.string.alpha({ length: { min: 33, max: 50 } })
  },
  options: {
    gender: ['Male', 'Female', 'Unknown'],
    attendantAtBirth: [
      'Physician',
      'Nurse',
      'Midwife',
      'Other paramedical personnel',
      'Layperson',
      'Traditional birth attendant',
      'None'
    ],
    birthType: [
      'Single',
      'Twin',
      'Triplet',
      'Quadruplet',
      'Higher multiple delivery'
    ],
    placeOfBirth: ['Health Institution', 'Residential address', 'Other']
  },
  dob: {
    past: toDateParts(subDays(new Date(), 1)),
    future: toDateParts(addDays(new Date(), 5)),
    // 31 February does not exist.
    invalid: { dd: '31', mm: '02', yyyy: '2024' },
    empty: { dd: '', mm: '', yyyy: '' },
    inLateRegistrationPeriod: toDateParts(
      subDays(new Date(), LATE_REGISTRATION_DAYS - 5)
    ),
    beforeLateRegistrationPeriod: toDateParts(
      subDays(new Date(), LATE_REGISTRATION_DAYS + 5)
    ),
    error: 'Must be a valid birth date',
    invalidError: 'Invalid date field'
  },
  reasonForDelay: 'Lack of awareness',
  healthInstitution: {
    // Both names contain this text.
    search: 'District Hospital',
    // In the Ibombo district, the jurisdiction of the registrar.
    inJurisdiction: 'Ibombo District Hospital',
    // In the Ilanga district, outside the jurisdiction of the registrar.
    outsideJurisdiction: 'Ilanga District Hospital'
  },
  address: {
    // The default values match the jurisdiction of the registrar.
    defaults: {
      country: 'Farajaland',
      province: 'Central',
      district: 'Ibombo'
    },
    village: 'Klow',
    // The address has the district of the registrar by default, and the
    // district is not a complete address. So the error is not "Required".
    emptyVillageError: 'Invalid input',
    optional: {
      town: faker.location.city(),
      residentialArea: faker.location.county(),
      street: faker.location.street(),
      number: faker.location.buildingNumber(),
      zipCode: faker.location.zipCode()
    }
  },
  weight: {
    moreThan6: '7',
    valid: '3.5',
    negative: '-2',
    // The field drops the negative sign and keeps the number.
    negativeWithoutSign: '2',
    error: 'Must be within 0 and 6'
  }
}

const CHILD_DETAILS_URL = /\/pages\/child/

// The test finds the option in the dropdown of the field, not in the full
// page. Other places on the page can show the same text. For example, after
// "Health Institution" is selected, a new field has the label
// "Health Institution".
async function selectDropdownOption(
  page: Page,
  fieldId: string,
  option: string
) {
  const field = page.locator(fieldId)
  await field.click()
  await field.getByText(option, { exact: true }).click()
  await expect(field).toContainText(option)
}

async function expectChildDetailsPage(page: Page) {
  await expect(page.getByText("Child's details", { exact: true })).toBeVisible()
}

async function openChildDetailsPage(page: Page) {
  await login(page, CREDENTIALS.REGISTRAR)
  await openBirthDeclaration(page)
  await expectChildDetailsPage(page)
}

async function goToReview(page: Page) {
  await page.getByRole('button', { name: 'Go to review' }).click()
  await expect(page).toHaveURL(/\/review/)
}

/** Goes back from the review page to the field on the child details page. */
async function changeOnReview(page: Page, fieldId: string) {
  await page.getByTestId(`change-button-${fieldId}`).click()
  await expect(page).toHaveURL(CHILD_DETAILS_URL)
  await expectChildDetailsPage(page)
}

async function enterDob(page: Page, date: DateParts) {
  await fillDate(page, date)
  await page.getByPlaceholder('yyyy').blur()
}

/**
 * Checks that the name field accepts `name`. The field first gets an invalid
 * name, so the error is visible. The valid name must then remove the error.
 * Without this, the check for a hidden error passes before validation runs.
 */
async function expectNameAccepted(page: Page, fieldId: string, name: string) {
  const error = page.locator(`${fieldId}_error`)

  await type(page, fieldId, child.names.invalid)
  await expect(error).toContainText(child.names.invalidError)

  await type(page, fieldId, name)
  await expect(error).toBeHidden()
}

for (const [stepNumber, field, otherFieldId] of [
  ['1', { id: '#firstname', label: 'First Name(s)' }, '#surname'],
  ['2', { id: '#surname', label: 'Last Name' }, '#firstname']
] as const) {
  test(
    `${stepNumber}. Validate the "${field.label}" text field`,
    { tag: ['@C2666'] },
    async ({ page }) => {
      const error = page.locator(`${field.id}_error`)
      const nameOnReview = page.getByTestId('child.name-value')

      await test.step('Setup: Log in and open the child details page', async () => {
        await openChildDetailsPage(page)
        // The other name field gets a valid name. Then the only error of the
        // name on the review page comes from this field.
        await type(page, otherFieldId, child.names.valid)
      })

      await test.step(`${stepNumber}.1 Enter non-English characters`, async () => {
        await expectNameAccepted(page, field.id, child.names.withNumber)
        await expectNameAccepted(page, field.id, child.names.withHyphen)

        await type(page, field.id, child.names.invalid)
        await expect(error).toContainText(child.names.invalidError)

        await expectNameAccepted(page, field.id, child.names.withApostrophe)

        // The review page shows the error for "John_Peter".
        await type(page, field.id, child.names.invalid)
        await goToReview(page)
        await expect(nameOnReview).toContainText(child.names.invalidError)
        await changeOnReview(page, 'child.name')
      })

      await test.step(`${stepNumber}.2 Enter less than 33 English characters`, async () => {
        await expectNameAccepted(
          page,
          field.id,
          child.names.lessThan33Characters
        )
      })

      await test.step(`${stepNumber}.3 Keep the field empty`, async () => {
        await type(page, field.id, '')
        await goToReview(page)

        await expect(nameOnReview).toContainText(REQUIRED_VALIDATION_ERROR)

        await changeOnReview(page, 'child.name')
      })

      await test.step(`${stepNumber}.4 Enter more than 32 English characters`, async () => {
        const longName = child.names.moreThan32Characters
        await type(page, field.id, longName)

        // The field keeps only the first 32 characters.
        await expect(page.locator(field.id)).toHaveValue(longName.slice(0, 32))
      })
    }
  )
}

test(
  '3. Validate the Sex dropdown field',
  { tag: ['@C2666'] },
  async ({ page }) => {
    await test.step('Setup: Log in and open the child details page', async () => {
      await openChildDetailsPage(page)
    })

    await test.step('3.1 Select each value of the dropdown', async () => {
      for (const option of child.options.gender) {
        await selectDropdownOption(page, '#child____gender', option)
      }
    })

    await test.step('3.2 Keep the field empty', async () => {
      // A selected value cannot be removed from the dropdown. So the test
      // exits the form without saving and opens a new form.
      await page.getByRole('button', { name: 'Exit', exact: true }).click()
      await page.getByRole('button', { name: 'Confirm' }).click()
      await expect(page).not.toHaveURL(CHILD_DETAILS_URL)
      await openBirthDeclaration(page)
      await expectChildDetailsPage(page)

      await goToReview(page)

      await expect(page.getByTestId('child.gender-value')).toHaveText(
        REQUIRED_VALIDATION_ERROR
      )
    })
  }
)

test(
  '4. Validate the date of birth field',
  { tag: ['@C2666'] },
  async ({ page }) => {
    const dobError = page.locator('#child____dob_error')

    await test.step('Setup: Log in and open the child details page', async () => {
      await openChildDetailsPage(page)
    })

    await test.step('4.1 Enter a date before the current date', async () => {
      await enterDob(page, child.dob.past)

      // The review page shows the date. This proves that the field accepts
      // it.
      await goToReview(page)
      await expect(page.getByTestId('child.dob-value')).toHaveText(
        formatDateObjectTo_dMMMMyyyy(child.dob.past)
      )
      await changeOnReview(page, 'child.dob')
    })

    await test.step('4.2 Enter an invalid date', async () => {
      await enterDob(page, child.dob.invalid)

      await expect(dobError).toHaveText(child.dob.invalidError)
    })

    await test.step('4.3 Enter a future date', async () => {
      await enterDob(page, child.dob.future)

      await expect(dobError).toHaveText(child.dob.error)
    })

    await test.step('4.4 Keep the field empty', async () => {
      await enterDob(page, child.dob.empty)
      await goToReview(page)

      await expect(page.getByTestId('child.dob-value')).toHaveText(
        REQUIRED_VALIDATION_ERROR
      )
    })
  }
)

test(
  '5. Validate "Reason for delayed registration"',
  { tag: ['@C2666'] },
  async ({ page }) => {
    const reasonLabel = page.getByText('Reason for delayed registration')

    await test.step('Setup: Log in and open the child details page', async () => {
      await openChildDetailsPage(page)
    })

    await test.step('5.1 Enter a date of birth in the delayed registration period', async () => {
      const dob = child.dob.inLateRegistrationPeriod
      await enterDob(page, dob)
      await expect(reasonLabel).toBeHidden()

      // The review page shows the date of birth, so the form has the date.
      // Then the review page must not show the reason.
      await goToReview(page)
      await expect(page.getByTestId('child.dob-value')).toHaveText(
        formatDateObjectTo_dMMMMyyyy(dob)
      )
      await expect(page.getByTestId('child.reason-value')).toHaveCount(0)
      await changeOnReview(page, 'child.dob')
    })

    await test.step('5.2 Enter a date of birth before the delayed registration period', async () => {
      await enterDob(page, child.dob.beforeLateRegistrationPeriod)

      await expect(reasonLabel).toBeVisible()
    })

    await test.step('5.3 Enter "Reason for delayed registration"', async () => {
      await type(page, '#child____reason', child.reasonForDelay)

      await expect(page.locator('#child____reason')).toHaveValue(
        child.reasonForDelay
      )
    })

    await test.step('5.4 Keep "Reason for delayed registration" empty', async () => {
      await type(page, '#child____reason', '')
      await goToReview(page)

      await expect(page.getByTestId('child.reason-value')).toHaveText(
        REQUIRED_VALIDATION_ERROR
      )
    })
  }
)

test(
  '6. Validate the "Place of delivery" field',
  { tag: ['@C2666'] },
  async ({ page }) => {
    await test.step('Setup: Log in and open the child details page', async () => {
      await openChildDetailsPage(page)
    })

    await test.step('6.1 Keep the field empty', async () => {
      await goToReview(page)

      await expect(page.getByTestId('child.placeOfBirth-value')).toHaveText(
        REQUIRED_VALIDATION_ERROR
      )

      await changeOnReview(page, 'child.placeOfBirth')
    })

    await test.step('6.2 Open the dropdown', async () => {
      const field = page.locator('#child____placeOfBirth')
      await field.click()

      // The registrar can select all 3 types of place.
      for (const option of child.options.placeOfBirth) {
        await expect(field.getByText(option, { exact: true })).toBeVisible()
      }

      await page.keyboard.press('Escape')
      for (const option of child.options.placeOfBirth) {
        await expect(field.getByText(option, { exact: true })).toBeHidden()
      }
    })

    await test.step('6.2 Select "Health Institution"', async () => {
      const { search, inJurisdiction, outsideJurisdiction } =
        child.healthInstitution
      const options = page.locator('[id^="locationOption"]')

      await selectDropdownOption(
        page,
        '#child____placeOfBirth',
        'Health Institution'
      )
      // TestRail calls the new dropdown "Location of birth". The UI label is
      // "Health Institution".
      await expect(page.locator('#child____birthLocation')).toBeVisible()

      // The list has only the health institutions of the jurisdiction of the
      // registrar. The institution in the jurisdiction shows first, so the
      // list has loaded when the test checks the other one.
      await page
        .locator('#searchable-select-child____birthLocation input')
        .fill(search)
      await expect(
        options.getByText(inJurisdiction, { exact: true })
      ).toBeVisible()
      await expect(
        options.getByText(outsideJurisdiction, { exact: true })
      ).toBeHidden()
    })

    for (const [option, formId] of [
      [
        'Residential address',
        '#child____birthLocation____privateHome-form-input'
      ],
      ['Other', '#child____birthLocation____other-form-input']
    ] as const) {
      await test.step(`6.2 Select "${option}"`, async () => {
        await selectDropdownOption(page, '#child____placeOfBirth', option)
        const form = page.locator(formId)
        await expect(form).toBeVisible()

        // The 4 required address dropdowns. A disabled dropdown input has no
        // size, so the test checks that the dropdowns exist.
        for (const id of ['country', 'province', 'district', 'village']) {
          await expect(form.locator(`#${id}`)).toHaveCount(1)
        }
        // The jurisdiction of the registrar is one district. So the province
        // and the district are disabled. The country and the village are
        // enabled.
        await expect(form.locator('#province')).toBeDisabled()
        await expect(form.locator('#district')).toBeDisabled()
        await expect(form.locator('#country')).toBeEnabled()
        await expect(form.locator('#village')).toBeEnabled()

        // The optional text fields.
        for (const id of Object.keys(child.address.optional)) {
          await expect(form.locator(`#${id}`)).toBeVisible()
        }
      })
    }
  }
)

test(
  '7. Validate the address of the place of delivery',
  { tag: ['@C2666'] },
  async ({ page }) => {
    const form = page.locator(
      '#child____birthLocation____privateHome-form-input'
    )

    await test.step('Setup: Log in and open the child details page', async () => {
      await openChildDetailsPage(page)
    })

    await test.step('7.1 Select "Residential address"', async () => {
      await selectDropdownOption(
        page,
        '#child____placeOfBirth',
        'Residential address'
      )

      await expect(form).toBeVisible()
      await expect(form.locator('#country')).toBeEnabled()
    })

    // The `#province` and `#district` ids are on the input of the dropdown,
    // which does not show the selected value. So the test finds the values
    // as text in the address form.
    await test.step('7.2 The "Country" dropdown has the default value', async () => {
      // The test keeps the default country. A different country replaces the
      // Farajaland fields that steps 7.3–7.5 check.
      await expect(
        form.getByText(child.address.defaults.country, { exact: true })
      ).toBeVisible()
    })

    await test.step('7.3 The "Province" dropdown has the default value', async () => {
      // The jurisdiction of the registrar is one district. So the dropdown is
      // disabled, and the test cannot select a different value.
      await expect(
        form.getByText(child.address.defaults.province, { exact: true })
      ).toBeVisible()
      await expect(form.locator('#province')).toBeDisabled()
    })

    await test.step('7.4 The "District" dropdown has the default value', async () => {
      // The dropdown is disabled for the same reason as the province.
      await expect(
        form.getByText(child.address.defaults.district, { exact: true })
      ).toBeVisible()
      await expect(form.locator('#district')).toBeDisabled()
    })

    await test.step('7.5 Select a village', async () => {
      await form.locator('#village').click()
      await selectLocationOption(page, child.address.village)

      await expect(
        form.getByText(child.address.village, { exact: true })
      ).toBeVisible()
    })

    await test.step('7.6 Enter the optional text fields', async () => {
      for (const [id, value] of Object.entries(child.address.optional)) {
        await form.locator(`#${id}`).fill(value)
        await expect(form.locator(`#${id}`)).toHaveValue(value)
      }
    })

    await test.step('7. An empty required address field shows an error on the review page', async () => {
      // The country, the province and the district always have a value, and
      // the village has a value from step 7.5. "Other" has a new address
      // with an empty village, so the test uses it.
      await selectDropdownOption(page, '#child____placeOfBirth', 'Other')
      await expect(
        page.locator('#child____birthLocation____other-form-input')
      ).toBeVisible()
      await goToReview(page)

      await expect(
        page.getByTestId('child.birthLocation.other-value')
      ).toHaveText(child.address.emptyVillageError)
    })
  }
)

test(
  '8. Validate the "Attendant at birth" dropdown field',
  { tag: ['@C2666'] },
  async ({ page }) => {
    await test.step('Setup: Log in and open the child details page', async () => {
      await openChildDetailsPage(page)
    })

    await test.step('8.1 Keep the field empty', async () => {
      await goToReview(page)

      // An empty optional field shows an empty value. The value can have no
      // height, so the test checks that it exists, not that it is visible.
      const value = page.getByTestId('child.attendantAtBirth-value')
      await expect(value).toHaveCount(1)
      await expect(value).not.toContainText(REQUIRED_VALIDATION_ERROR)

      await changeOnReview(page, 'child.attendantAtBirth')
    })

    await test.step('8.2 Select each value of the dropdown', async () => {
      for (const option of child.options.attendantAtBirth) {
        await selectDropdownOption(page, '#child____attendantAtBirth', option)
      }
    })
  }
)

test(
  '9. Validate the "Type of birth" dropdown field',
  { tag: ['@C2666'] },
  async ({ page }) => {
    await test.step('Setup: Log in and open the child details page', async () => {
      await openChildDetailsPage(page)
    })

    await test.step('9.1 Keep the field empty', async () => {
      await goToReview(page)

      // An empty optional field shows an empty value. The value can have no
      // height, so the test checks that it exists, not that it is visible.
      const value = page.getByTestId('child.birthType-value')
      await expect(value).toHaveCount(1)
      await expect(value).not.toContainText(REQUIRED_VALIDATION_ERROR)

      await changeOnReview(page, 'child.birthType')
    })

    await test.step('9.2 Select each value of the dropdown', async () => {
      for (const option of child.options.birthType) {
        await selectDropdownOption(page, '#child____birthType', option)
      }
    })
  }
)

test(
  '10. Validate the "Weight at birth" field',
  { tag: ['@C2666'] },
  async ({ page }) => {
    const weight = page.locator('#child____weightAtBirth')
    const weightError = page.locator('#child____weightAtBirth_error')

    await test.step('Setup: Log in and open the child details page', async () => {
      await openChildDetailsPage(page)
    })

    await test.step('10.1 Keep the field empty', async () => {
      await goToReview(page)

      // An empty optional field shows an empty value. The value can have no
      // height, so the test checks that it exists, not that it is visible.
      const value = page.getByTestId('child.weightAtBirth-value')
      await expect(value).toHaveCount(1)
      await expect(value).not.toContainText(REQUIRED_VALIDATION_ERROR)

      await changeOnReview(page, 'child.weightAtBirth')
    })

    await test.step('10.2 Enter a negative number', async () => {
      await weight.clear()
      await weight.pressSequentially(child.weight.negative)

      await expect(weight).toHaveValue(child.weight.negativeWithoutSign)
    })

    await test.step('10.3 Enter a positive number of 6 or less', async () => {
      await type(page, '#child____weightAtBirth', child.weight.valid)
      await expect(weight).toHaveValue(child.weight.valid)

      // The review page shows the weight without an error. This proves that
      // the field accepts it.
      await goToReview(page)
      const weightOnReview = page.getByTestId('child.weightAtBirth-value')
      await expect(weightOnReview).toContainText(child.weight.valid)
      await expect(weightOnReview).not.toContainText(child.weight.error)
      await changeOnReview(page, 'child.weightAtBirth')
    })

    await test.step('10.4 Enter a number more than 6', async () => {
      await type(page, '#child____weightAtBirth', child.weight.moreThan6)

      await expect(weightError).toHaveText(child.weight.error)
    })
  }
)

test('11. Click "Continue"', { tag: ['@C2666'] }, async ({ page }) => {
  await test.step('Setup: Log in and open the child details page', async () => {
    await openChildDetailsPage(page)
  })

  await test.step('11. Click "Continue"', async () => {
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page).toHaveURL(/\/pages\/informant/)
    await expect(
      page.getByText("Informant's details", { exact: true })
    ).toBeVisible()
  })
})
