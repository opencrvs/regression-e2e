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
import { getToken, login } from '@support/helpers'
import { CREDENTIALS, GATEWAY_HOST } from '@support/constants'
import { createClient } from '@opencrvs/toolkit/api'
import {
  fillDate,
  openBirthDeclaration,
  REQUIRED_VALIDATION_ERROR
} from '@support/birth/helpers'
import { selectLocationOption, type } from '@support/utils'

// The country config shows "Reason for delayed registration" when the child
// is older than this number of days.
const LATE_REGISTRATION_DAYS = 365

function toDateParts(date: Date) {
  return {
    dd: format(date, 'dd'),
    mm: format(date, 'MM'),
    yyyy: format(date, 'yyyy')
  }
}

/** All the values that the tests enter and expect, in one place. */
const child = {
  names: {
    // TestRail steps 1.1 and 2.1. The field accepts these names.
    accepted: ['Richard the 3rd', 'John-Peter', "O'Neill"],
    // TestRail steps 1.1 and 2.1. The field shows an error for this name.
    invalid: 'John_Peter',
    // The start of the error message. The full message in the UI is a little
    // different from the message in TestRail.
    invalidError: 'Input contains invalid characters',
    valid: faker.person.firstName(),
    lessThan33Characters: 'Rakibul Islam',
    moreThan32Characters: 'Ovuvuevuevue Enyetuenwuevue Ugbemugbem Osas'
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
    // TestRail has "Twins" and "Higher Multiple delivery". The UI has
    // "Twin" and "Higher multiple delivery".
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
    inLateRegistrationPeriod: toDateParts(
      subDays(new Date(), LATE_REGISTRATION_DAYS - 5)
    ),
    beforeLateRegistrationPeriod: toDateParts(
      subDays(new Date(), LATE_REGISTRATION_DAYS + 5)
    ),
    // TestRail has "Must be a valid Birthdate".
    error: 'Must be a valid birth date',
    // TestRail expects "Must be a valid Birthdate" for an invalid date too.
    // The UI shows this message.
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
    // TestRail says that an empty village shows "Required". The UI shows
    // "Invalid input", because the address has the district of the registrar
    // by default, and the district is not a complete address.
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

// A new declaration form creates an event on the server. The tests do not
// submit the form, so each test deletes its event at the end.
const createdEventIds: string[] = []

test.beforeEach(async ({ page }) => {
  page.on('response', async (response) => {
    if (
      response.status() === 200 &&
      response.url().includes('/api/events/event.create')
    ) {
      try {
        const body = await response.json()
        createdEventIds.push(body.result.data.json.id)
      } catch {
        // The response is not the expected JSON. Do nothing.
      }
    }
  })
})

test.afterAll(async () => {
  const token = await getToken(CREDENTIALS.REGISTRAR)
  const client = createClient(GATEWAY_HOST + '/events', `Bearer ${token}`)
  await Promise.allSettled(
    createdEventIds.map((eventId) => client.event.delete.mutate({ eventId }))
  )
})

async function selectDropdownOption(
  page: Page,
  fieldId: string,
  option: string
) {
  await page.locator(fieldId).click()
  await page.getByText(option, { exact: true }).click()
  await expect(page.locator(fieldId)).toContainText(option)
}

async function openChildDetailsPage(page: Page) {
  await login(page, CREDENTIALS.REGISTRAR)
  await openBirthDeclaration(page)
  await expect(page.getByText("Child's details", { exact: true })).toBeVisible()
}

async function goToReview(page: Page) {
  await page.getByRole('button', { name: 'Go to review' }).click()
  await expect(page).toHaveURL(/\/review/)
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

for (const [stepNumber, field, otherField] of [
  ['1', { id: '#firstname', label: 'First Name(s)' }, '#surname'],
  ['2', { id: '#surname', label: 'Last Name' }, '#firstname']
] as const) {
  test(
    `"${field.label}" accepts only valid names`,
    { tag: ['@C2666'] },
    async ({ page }) => {
      await test.step('Setup: Log in and open the child details page', async () => {
        await openChildDetailsPage(page)
      })

      await test.step(`${stepNumber}.1 Enter names with special characters`, async () => {
        for (const name of child.names.accepted) {
          await expectNameAccepted(page, field.id, name)
        }

        await type(page, field.id, child.names.invalid)
        await expect(page.locator(`${field.id}_error`)).toContainText(
          child.names.invalidError
        )
      })

      await test.step(`${stepNumber}.2 Enter less than 33 English characters`, async () => {
        await expectNameAccepted(
          page,
          field.id,
          child.names.lessThan33Characters
        )
      })

      await test.step(`${stepNumber}.4 Enter more than 32 English characters`, async () => {
        const longName = child.names.moreThan32Characters
        await type(page, field.id, longName)

        // The field keeps only the first 32 characters.
        await expect(page.locator(field.id)).toHaveValue(longName.slice(0, 32))
      })

      await test.step(`${stepNumber}.1 The review page shows the error for "${child.names.invalid}"`, async () => {
        // The other name field gets a valid name, so the only error of the
        // name is the invalid characters.
        await type(page, otherField, child.names.valid)
        await type(page, field.id, child.names.invalid)
        await goToReview(page)

        await expect(page.getByTestId('child.name-value')).toContainText(
          child.names.invalidError
        )
      })

      // Step `${stepNumber}.3` (an empty field) is in the test
      // "Empty required fields show Required on the review page".
    }
  )
}

test(
  'Sex, "Attendant at birth" and "Type of birth" select each option',
  { tag: ['@C2666'] },
  async ({ page }) => {
    await test.step('Setup: Log in and open the child details page', async () => {
      await openChildDetailsPage(page)
    })

    await test.step('3.1 Select each value of the Sex dropdown', async () => {
      for (const option of child.options.gender) {
        await selectDropdownOption(page, '#child____gender', option)
      }
    })

    await test.step('8.2 Select each value of "Attendant at birth"', async () => {
      for (const option of child.options.attendantAtBirth) {
        await selectDropdownOption(page, '#child____attendantAtBirth', option)
      }
    })

    await test.step('9.2 Select each value of "Type of birth"', async () => {
      for (const option of child.options.birthType) {
        await selectDropdownOption(page, '#child____birthType', option)
      }
    })

    await test.step('11. Click "Continue"', async () => {
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(
        page.getByText("Informant's details", { exact: true })
      ).toBeVisible()
    })
  }
)

test(
  'Date of birth accepts a past date and rejects a future or invalid date',
  { tag: ['@C2666'] },
  async ({ page }) => {
    const dobError = page.locator('#child____dob_error')

    async function enterDob(date: { dd: string; mm: string; yyyy: string }) {
      await fillDate(page, date)
      await page.getByPlaceholder('yyyy').blur()
    }

    await test.step('Setup: Log in and open the child details page', async () => {
      await openChildDetailsPage(page)
    })

    await test.step('4.3 Enter a future date', async () => {
      await enterDob(child.dob.future)

      await expect(dobError).toHaveText(child.dob.error)
    })

    await test.step('4.1 Enter a date before the current date', async () => {
      // The future date of step 4.3 shows the error first. So this step
      // proves that a past date removes the error.
      await enterDob(child.dob.past)

      await expect(dobError).toBeHidden()
    })

    await test.step('4.2 Enter an invalid date', async () => {
      await enterDob(child.dob.invalid)

      await expect(dobError).toHaveText(child.dob.invalidError)
    })

    // Step 4.4 (an empty field) is in the test
    // "Empty required fields show Required on the review page".
  }
)

test(
  '"Reason for delayed registration" shows for a late registration',
  { tag: ['@C2666'] },
  async ({ page }) => {
    const reasonLabel = page.getByText('Reason for delayed registration')

    await test.step('Setup: Log in and open the child details page', async () => {
      await openChildDetailsPage(page)
    })

    await test.step('5.2 Enter a date of birth before the delayed registration period', async () => {
      await fillDate(page, child.dob.beforeLateRegistrationPeriod)

      await expect(reasonLabel).toBeVisible()
    })

    await test.step('5.1 Enter a date of birth in the delayed registration period', async () => {
      // Step 5.2 shows the field first. So this step proves that the field
      // goes away.
      await fillDate(page, child.dob.inLateRegistrationPeriod)

      await expect(reasonLabel).toBeHidden()
    })

    await test.step('5.3 Enter "Reason for delayed registration"', async () => {
      await fillDate(page, child.dob.beforeLateRegistrationPeriod)
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
  '"Place of delivery" shows the fields for each type of place',
  { tag: ['@C2666'] },
  async ({ page }) => {
    await test.step('Setup: Log in and open the child details page', async () => {
      await openChildDetailsPage(page)
    })

    await test.step('6.2 Open the "Place of delivery" dropdown', async () => {
      await page.locator('#child____placeOfBirth').click()

      // The registrar can select all 3 types of place.
      for (const option of child.options.placeOfBirth) {
        await expect(page.getByText(option, { exact: true })).toBeVisible()
      }

      await page.keyboard.press('Escape')
      await expect(
        page.getByText('Residential address', { exact: true })
      ).toBeHidden()
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

      await selectLocationOption(page, inJurisdiction)
      await expect(
        page.locator('#searchable-select-child____birthLocation')
      ).toContainText(inJurisdiction)
    })

    await test.step('6.2 and 7. Select "Residential address" and fill the address', async () => {
      await selectDropdownOption(
        page,
        '#child____placeOfBirth',
        'Residential address'
      )
      const form = page.locator(
        '#child____birthLocation____privateHome-form-input'
      )
      await expect(form).toBeVisible()

      // 7.1–7.4 The country, the province and the district have default
      // values that match the jurisdiction of the registrar.
      // The `#province` and `#district` ids are on the input of the dropdown,
      // which does not show the selected value. So the test finds the values
      // as text in the address form.
      for (const value of Object.values(child.address.defaults)) {
        await expect(form.getByText(value, { exact: true })).toBeVisible()
      }
      // 6.2 The jurisdiction of the registrar is one district. So the
      // province and the district are disabled, and the test cannot select a
      // different value (7.3 and 7.4).
      await expect(form.locator('#province')).toBeDisabled()
      await expect(form.locator('#district')).toBeDisabled()
      // 7.2 The test keeps the default country. A different country replaces
      // the Farajaland fields that steps 7.3–7.5 check.

      // 7.5 The village has no default value.
      await form.locator('#village').click()
      await selectLocationOption(page, child.address.village)
      await expect(
        form.getByText(child.address.village, { exact: true })
      ).toBeVisible()

      // 7.6 The optional text fields.
      for (const [id, value] of Object.entries(child.address.optional)) {
        await form.locator(`#${id}`).fill(value)
        await expect(form.locator(`#${id}`)).toHaveValue(value)
      }
    })

    await test.step('6.2 Select "Other"', async () => {
      await selectDropdownOption(page, '#child____placeOfBirth', 'Other')
      const form = page.locator('#child____birthLocation____other-form-input')

      // "Other" has the same address fields as "Residential address".
      await expect(form).toBeVisible()
      // A disabled dropdown input has no size, so the test checks that the
      // dropdowns exist and that the default values show.
      for (const id of ['country', 'province', 'district', 'village']) {
        await expect(form.locator(`#${id}`)).toHaveCount(1)
      }
      for (const value of Object.values(child.address.defaults)) {
        await expect(form.getByText(value, { exact: true })).toBeVisible()
      }
      for (const id of Object.keys(child.address.optional)) {
        await expect(form.locator(`#${id}`)).toBeVisible()
      }
    })
  }
)

test(
  '"Weight at birth" accepts only a number from 0 to 6',
  { tag: ['@C2666'] },
  async ({ page }) => {
    const weight = page.locator('#child____weightAtBirth')
    const weightError = page.locator('#child____weightAtBirth_error')

    await test.step('Setup: Log in and open the child details page', async () => {
      await openChildDetailsPage(page)
    })

    await test.step('10.4 Enter a number more than 6', async () => {
      await type(page, '#child____weightAtBirth', child.weight.moreThan6)

      await expect(weightError).toHaveText(child.weight.error)
    })

    await test.step('10.3 Enter a positive number of 6 or less', async () => {
      // Step 10.4 shows the error first. So this step proves that a valid
      // number removes the error.
      await type(page, '#child____weightAtBirth', child.weight.valid)

      await expect(weight).toHaveValue(child.weight.valid)
      await expect(weightError).toBeHidden()
    })

    await test.step('10.2 Enter a negative number', async () => {
      await weight.clear()
      await weight.pressSequentially(child.weight.negative)

      await expect(weight).toHaveValue(child.weight.negativeWithoutSign)
    })

    // Step 10.1 (an empty field) is in the test
    // "Empty required fields show Required on the review page".
  }
)

test(
  'Empty required fields show "Required" on the review page',
  { tag: ['@C2666'] },
  async ({ page }) => {
    const nameOnReview = page.getByTestId('child.name-value')

    await test.step('Setup: Log in and open the child details page', async () => {
      await openChildDetailsPage(page)
    })

    await test.step('2.3 Enter only the first name', async () => {
      await type(page, '#firstname', child.names.valid)
    })

    await test.step('7. Select "Residential address" and keep the village empty', async () => {
      await selectDropdownOption(
        page,
        '#child____placeOfBirth',
        'Residential address'
      )
      await expect(
        page.locator('#child____birthLocation____privateHome-form-input')
      ).toBeVisible()
    })

    await test.step('Click "Go to review"', async () => {
      await goToReview(page)
    })

    await test.step('2.3 The surname is empty', async () => {
      await expect(nameOnReview).toContainText(REQUIRED_VALIDATION_ERROR)
    })

    await test.step('3.2 The sex is empty', async () => {
      await expect(page.getByTestId('child.gender-value')).toHaveText(
        REQUIRED_VALIDATION_ERROR
      )
    })

    await test.step('4.4 The date of birth is empty', async () => {
      await expect(page.getByTestId('child.dob-value')).toHaveText(
        REQUIRED_VALIDATION_ERROR
      )
    })

    await test.step('7. The village of the address is empty', async () => {
      await expect(
        page.getByTestId('child.birthLocation.privateHome-value')
      ).toHaveText(child.address.emptyVillageError)
    })

    await test.step('8.1, 9.1 and 10.1 The optional fields are empty', async () => {
      for (const field of ['attendantAtBirth', 'birthType', 'weightAtBirth']) {
        const value = page.getByTestId(`child.${field}-value`)
        // An empty optional field shows an empty value. The value can have
        // no height, so the test checks that it exists, not that it is
        // visible.
        await expect(value).toHaveCount(1)
        await expect(value).not.toContainText(REQUIRED_VALIDATION_ERROR)
      }
    })

    await test.step('1.3 Enter only the surname', async () => {
      await page.getByTestId('change-button-child.name').click()
      await type(page, '#firstname', '')
      await type(page, '#surname', child.names.valid)
      await goToReview(page)

      // The review page shows only the error of a name that has an error,
      // not the part of the name that the user entered.
      await expect(nameOnReview).toHaveText(REQUIRED_VALIDATION_ERROR)
    })
  }
)

test(
  'An empty "Place of delivery" shows "Required" on the review page',
  { tag: ['@C2666'] },
  async ({ page }) => {
    await test.step('Setup: Log in and open the child details page', async () => {
      await openChildDetailsPage(page)
    })

    await test.step('6.1 Keep "Place of delivery" empty', async () => {
      await goToReview(page)

      await expect(page.getByTestId('child.placeOfBirth-value')).toHaveText(
        REQUIRED_VALIDATION_ERROR
      )
    })
  }
)
