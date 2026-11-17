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
import { expect } from '@playwright/test'
import { createClient } from '@opencrvs/toolkit/api'
import { ActionType, AddressType } from '@opencrvs/toolkit/events'
import { CREDENTIALS, GATEWAY_HOST } from '@support/constants'
import { getToken } from '@support/helpers'
import { getAdministrativeAreas, getIdByName } from '@support/birth/helpers'
import {
  createDeclaration as createBirth,
  getDeclaration as getBirthDeclaration
} from '@support/test-data/birth-declaration'
import { createDeclaration as createDeath } from '@support/test-data/death-declaration'
import {
  archiveViaApi,
  createBirthDraftViaApi,
  customActionViaApi
} from '@support/test-data/api-actions'
import { getSignatureFile, uploadFile } from '@support/test-data/utils'

/*
 * Test data for quick search (TestRail C2491 and its extensions).
 * The records are TD-01 to TD-09 in the test data workbook
 * test-data-search-quick-search-2026-11-17.xlsx.
 *
 * The names are random, so that parallel runs do not collide. Each run
 * builds the near-miss names from the base names, and checks the edit
 * distances, so the fuzzy rule is always tested at the same distances.
 *
 * Fuzzy rule (Elasticsearch fuzziness AUTO, counted on each search word):
 * 1-2 letters = exact only, 3-5 letters = 1 edit, more than 5 letters = 2
 * edits. A swap of two adjacent letters is 1 edit.
 */

const VOWELS = 'aeiou'
const CONSONANTS = 'bcdfghjklmnprstvwz'
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
// Rare letters for the short names, so that few other records are within
// 1 edit and the record stays on the first page of results.
const RARE = 'jqvxz'

const pick = (chars: string) => faker.helpers.arrayElement(chars.split(''))
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A readable random word of `length` letters (consonant, vowel, ...). */
function word(length: number) {
  let result = ''
  for (let i = 0; i < length; i++) {
    result += pick(i % 2 === 0 ? CONSONANTS : VOWELS)
  }
  return capitalise(result)
}

/** A random word of `length` rare letters (for short names). */
function rareWord(length: number) {
  let result = ''
  for (let i = 0; i < length; i++) result += pick(RARE)
  return capitalise(result)
}

/** Replaces the letters at `positions` with other letters. */
function substitute(value: string, positions: number[]) {
  const chars = value.split('')
  for (const i of positions) {
    const current = chars[i].toLowerCase()
    let next = pick(LETTERS)
    while (next === current) next = pick(LETTERS)
    chars[i] = i === 0 ? next.toUpperCase() : next
  }
  return chars.join('')
}

/** Swaps each pair of adjacent letters at `positions` (i and i+1). */
function swap(value: string, positions: number[]) {
  const chars = value.split('')
  for (const i of positions) {
    ;[chars[i], chars[i + 1]] = [chars[i + 1], chars[i]]
  }
  return chars.join('')
}

/**
 * Optimal string alignment distance (Damerau-Levenshtein without
 * repeated edits of one substring). This is the distance that
 * Elasticsearch uses when transpositions are on (the default).
 */
export function editDistance(a: string, b: string) {
  const s = a.toLowerCase()
  const t = b.toLowerCase()
  const d: number[][] = Array.from({ length: s.length + 1 }, (_, i) =>
    Array.from({ length: t.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0
    )
  )
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      )
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[s.length][t.length]
}

function buildNames() {
  // TD-01 (A)
  const childFirst = word(9)
  const childSurname = word(10)
  const fatherFirst = word(6)
  const fatherSurname = word(9)
  const informantFirst = word(6)
  const informantSurname = word(8)
  const motherFirst = word(8)
  const motherSurnameEnd = word(4)
  const motherSurname = `${word(8)}-${motherSurnameEnd}`

  // TD-03 (C)
  const shortChildFirst = rareWord(2)
  const shortMotherFirst = rareWord(4)
  const shortMotherSurname = word(9)

  return {
    a: {
      childFirst,
      childSurname,
      fatherFirst,
      fatherSurname,
      informantFirst,
      informantSurname,
      motherFirst,
      motherSurname,
      motherSurnameEnd
    },
    // TD-02 (B): 1 edit from A in the child, father and informant names
    b: {
      childFirst: substitute(childFirst, [8]),
      childSurname: childSurname.slice(0, 3) + childSurname.slice(4),
      fatherFirst: substitute(fatherFirst, [0]),
      fatherSurname: substitute(fatherSurname, [4]),
      informantFirst: informantFirst + pick(CONSONANTS),
      informantSurname: informantSurname + pick(CONSONANTS)
    },
    c: {
      childFirst: shortChildFirst,
      childSurname: word(10),
      motherFirst: shortMotherFirst,
      motherSurname: shortMotherSurname
    },
    // TD-04 (D): 3 edits from A in each child name
    d: {
      childFirst: substitute(childFirst, [1, 4, 6]),
      childSurname: substitute(childSurname, [2, 5, 8])
    },
    terms: {
      // More than 5 letters, 2 edits: matches A only
      twoSwaps: swap(childFirst, [2, 5]),
      twoSubstitutions: substitute(childFirst, [1, 7]),
      // More than 5 letters, 2 edits: matches C
      motherSurnameTwoEdits: substitute(shortMotherSurname, [7, 8]),
      motherFirstPlusTwo: shortMotherFirst + pick(RARE) + pick(RARE),
      // 3-5 letters, 1 edit: matches
      surnameEndSwap: swap(motherSurnameEnd, [1]),
      motherFirstOneEdit: substitute(shortMotherFirst, [3]),
      motherFirstPlusOne: shortMotherFirst + pick(RARE),
      childFirstPlusOne: shortChildFirst + pick(RARE),
      // 3-5 letters, 2 edits: does not match
      motherFirstTwoEdits: substitute(shortMotherFirst, [2, 3]),
      motherFirstFiveTwoEdits:
        substitute(shortMotherFirst, [1]).slice(0, 3) +
        pick(LETTERS) +
        shortMotherFirst.slice(3),
      // 1-2 letters, 1 edit: does not match
      childFirstOneEdit: substitute(shortChildFirst, [1]),
      unusedName: word(11)
    }
  }
}

type Names = ReturnType<typeof buildNames>

/** Returns the reason why the names do not give the planned distances. */
function checkNames(n: Names): string | undefined {
  const rules: [string, string, (d: number) => boolean][] = [
    [n.a.childFirst, n.b.childFirst, (d) => d === 1],
    [n.a.childSurname, n.b.childSurname, (d) => d === 1],
    [n.a.fatherFirst, n.b.fatherFirst, (d) => d === 1],
    [n.a.informantFirst, n.b.informantFirst, (d) => d === 1],
    [n.a.fatherSurname, n.b.fatherSurname, (d) => d === 1],
    [n.a.informantSurname, n.b.informantSurname, (d) => d === 1],
    [n.a.childFirst, n.d.childFirst, (d) => d === 3],
    [n.b.childFirst, n.d.childFirst, (d) => d >= 3],
    [n.a.childSurname, n.d.childSurname, (d) => d === 3],
    [n.b.childSurname, n.d.childSurname, (d) => d >= 3],
    [n.terms.twoSwaps, n.a.childFirst, (d) => d === 2],
    [n.terms.twoSwaps, n.b.childFirst, (d) => d >= 3],
    [n.terms.twoSwaps, n.d.childFirst, (d) => d >= 3],
    [n.terms.twoSubstitutions, n.a.childFirst, (d) => d === 2],
    [n.terms.twoSubstitutions, n.b.childFirst, (d) => d >= 3],
    [n.terms.twoSubstitutions, n.d.childFirst, (d) => d >= 3],
    [n.terms.motherSurnameTwoEdits, n.c.motherSurname, (d) => d === 2],
    [n.terms.surnameEndSwap, n.a.motherSurnameEnd, (d) => d === 1],
    [n.terms.motherFirstOneEdit, n.c.motherFirst, (d) => d === 1],
    [n.terms.motherFirstTwoEdits, n.c.motherFirst, (d) => d === 2],
    [n.terms.motherFirstFiveTwoEdits, n.c.motherFirst, (d) => d === 2],
    [n.terms.childFirstOneEdit, n.c.childFirst, (d) => d === 1]
  ]
  for (const [term, name, ok] of rules) {
    const distance = editDistance(term, name)
    if (!ok(distance)) return `${term} -> ${name} = ${distance}`
  }
  if (n.terms.motherFirstFiveTwoEdits.length !== 5) return 'length'

  // Each TD-01 name must match only its own field: every other TD-01,
  // TD-02 and TD-04 name of another field is at least 3 edits away.
  const fields: [string, string[]][] = [
    ['childFirst', [n.a.childFirst, n.b.childFirst, n.d.childFirst]],
    ['childSurname', [n.a.childSurname, n.b.childSurname, n.d.childSurname]],
    ['fatherFirst', [n.a.fatherFirst, n.b.fatherFirst]],
    ['fatherSurname', [n.a.fatherSurname, n.b.fatherSurname]],
    ['informantFirst', [n.a.informantFirst, n.b.informantFirst]],
    ['informantSurname', [n.a.informantSurname, n.b.informantSurname]],
    ['motherFirst', [n.a.motherFirst]],
    ['motherSurname', n.a.motherSurname.split('-')]
  ]
  for (const [field, values] of fields) {
    for (const [otherField, otherValues] of fields) {
      if (field === otherField) continue
      for (const value of values) {
        for (const other of otherValues) {
          if (editDistance(value, other) < 3) {
            return `${field} ${value} is near ${otherField} ${other}`
          }
        }
      }
    }
  }
  return undefined
}

/** Builds random names that give the planned edit distances. */
export function buildQuickSearchNames(): Names {
  for (let attempt = 0; attempt < 200; attempt++) {
    const names = buildNames()
    if (!checkNames(names)) return names
  }
  throw new Error(
    'Could not build quick search names with the planned distances'
  )
}

const nid = () => faker.string.numeric(10)
const phone = () => `07${faker.string.numeric(8)}`
const email = (label: string) =>
  `${label}.${faker.string.alpha({ length: 6, casing: 'lower' })}@example.com`

export const fullName = (first: string, surname: string) =>
  `${first} ${surname}`

/** Changes the last character to another character of the same kind. */
export function changeLastCharacter(value: string) {
  const last = value.slice(-1)
  const pool = /\d/.test(last) ? '0123456789' : 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  let next = pick(pool)
  while (next === last) next = pick(pool)
  return value.slice(0, -1) + next
}

async function getVillageId(token: string, name: string) {
  return getIdByName(await getAdministrativeAreas(token), name)
}

function privateHomeIn(villageId: string) {
  return {
    'child.placeOfBirth': 'PRIVATE_HOME',
    'child.birthLocation.privateHome': {
      country: 'FAR',
      addressType: AddressType.DOMESTIC,
      administrativeArea: villageId
    },
    'child.birthLocationId': villageId
  }
}

/**
 * Creates TD-01 to TD-05: the records that C2491 needs.
 * TD-01 is registered by k.mweene. TD-02 to TD-05 are declared by
 * f.katongo. The helpers put every place of event in Klow (Ibombo), so
 * k.mweene can find them.
 */
export async function createQuickSearchRecords() {
  const names = buildQuickSearchNames()
  const registrarToken = await getToken(CREDENTIALS.REGISTRAR)
  const agentToken = await getToken(CREDENTIALS.REGISTRATION_OFFICER)

  // TD-01 (A): main record, registered, with all searchable values
  const a = {
    motherNid: nid(),
    fatherNid: nid(),
    informantNid: nid(),
    phone: phone(),
    email: email('td01')
  }
  const tdA = await createBirth(
    registrarToken,
    await getBirthDeclaration({
      token: registrarToken,
      informantRelation: 'BROTHER',
      partialDeclaration: {
        'child.name': {
          firstname: names.a.childFirst,
          surname: names.a.childSurname
        },
        'mother.name': {
          firstname: names.a.motherFirst,
          surname: names.a.motherSurname
        },
        'mother.nid': a.motherNid,
        'father.detailsNotAvailable': false,
        'father.name': {
          firstname: names.a.fatherFirst,
          surname: names.a.fatherSurname
        },
        'father.dob': '1993-07-22',
        'father.nationality': 'FAR',
        'father.idType': 'NATIONAL_ID',
        'father.nid': a.fatherNid,
        'father.addressSameAs': 'YES',
        'informant.name': {
          firstname: names.a.informantFirst,
          surname: names.a.informantSurname
        },
        'informant.dob': '2006-05-30',
        'informant.nid': a.informantNid,
        'informant.phoneNo': a.phone,
        'informant.email': a.email
      }
    }),
    ActionType.REGISTER
  )

  // TD-02 (B): 1 edit from A in every child, father and informant name.
  // The mother is unrelated, so that dedup
  // does not flag the record (every dedup rule needs a similar mother).
  const tdB = await createBirth(
    agentToken,
    await getBirthDeclaration({
      token: agentToken,
      informantRelation: 'BROTHER',
      partialDeclaration: {
        'child.name': {
          firstname: names.b.childFirst,
          surname: names.b.childSurname
        },
        'mother.name': { firstname: word(6), surname: word(9) },
        'mother.dob': '1988-01-09',
        'father.detailsNotAvailable': false,
        'father.name': {
          firstname: names.b.fatherFirst,
          surname: names.b.fatherSurname
        },
        'father.dob': '1987-05-03',
        'father.nationality': 'FAR',
        'father.idType': 'NATIONAL_ID',
        'father.nid': nid(),
        'father.addressSameAs': 'YES',
        'informant.name': {
          firstname: names.b.informantFirst,
          surname: names.b.informantSurname
        },
        'informant.dob': '2005-02-14',
        'informant.phoneNo': phone(),
        'informant.email': email('td02')
      }
    }),
    ActionType.DECLARE
  )

  // TD-03 (C): short names for the 1-2 and 3-5 letter tiers
  const tdC = await createBirth(
    agentToken,
    await getBirthDeclaration({
      token: agentToken,
      partialDeclaration: {
        'child.name': {
          firstname: names.c.childFirst,
          surname: names.c.childSurname
        },
        'mother.name': {
          firstname: names.c.motherFirst,
          surname: names.c.motherSurname
        },
        'informant.phoneNo': phone(),
        'informant.email': email('td03')
      }
    }),
    ActionType.DECLARE
  )

  // TD-04 (D): 3 edits from A in each child name. Must not match.
  const tdD = await createBirth(
    agentToken,
    await getBirthDeclaration({
      token: agentToken,
      partialDeclaration: {
        'child.name': {
          firstname: names.d.childFirst,
          surname: names.d.childSurname
        },
        'mother.name': { firstname: word(8), surname: word(8) },
        'informant.phoneNo': phone(),
        'informant.email': email('td04')
      }
    }),
    ActionType.DECLARE
  )

  // TD-05 (E): death record in Klow
  const deceased = { firstname: word(7), surname: word(9) }
  const deceasedNid = nid()
  const tdE = await createDeath(
    agentToken,
    {
      'deceased.name': deceased,
      'deceased.nid': deceasedNid,
      'spouse.name': { firstname: word(7), surname: deceased.surname },
      'informant.phoneNo': phone(),
      'informant.email': email('td05')
    },
    ActionType.DECLARE
  )

  return {
    names,
    a: {
      ...a,
      eventType: 'birth',
      title: fullName(names.a.childFirst, names.a.childSurname),
      trackingId: tdA.trackingId as string,
      registrationNumber: tdA.registrationNumber
    },
    b: {
      eventType: 'birth',
      title: fullName(names.b.childFirst, names.b.childSurname),
      trackingId: tdB.trackingId as string
    },
    c: {
      eventType: 'birth',
      title: fullName(names.c.childFirst, names.c.childSurname),
      trackingId: tdC.trackingId as string
    },
    d: {
      eventType: 'birth',
      title: fullName(names.d.childFirst, names.d.childSurname),
      trackingId: tdD.trackingId as string
    },
    e: {
      eventType: 'death',
      title: fullName(deceased.firstname, deceased.surname),
      surname: deceased.surname,
      nid: deceasedNid,
      trackingId: tdE.trackingId as string
    }
  }
}

/**
 * Waits until search finds each record by its tracking ID. The test uses
 * the API search, not the search bar, so that a broken search bar fails
 * in the test step that checks it, not in the setup. The API search uses
 * the same index and the same jurisdiction rules as the search bar.
 */
export async function waitUntilSearchable(
  records: { eventType: string; trackingId: string }[],
  username = CREDENTIALS.REGISTRAR
) {
  const token = await getToken(username)
  const client = createClient(GATEWAY_HOST + '/events', `Bearer ${token}`)
  for (const { eventType, trackingId } of records) {
    await expect
      .poll(
        async () => {
          const result = await client.event.search.query({
            query: {
              type: 'and',
              clauses: [
                { eventType, trackingId: { type: 'exact', term: trackingId } }
              ]
            }
          } as never)
          return (result as { total: number }).total
        },
        {
          message: `Search does not find ${eventType} ${trackingId}`,
          timeout: 60_000
        }
      )
      .toBeGreaterThan(0)
  }
}

/** TD-06 (F): registered birth in Oya (Pualula), by n.siame. */
export async function createOtherJurisdictionRecord() {
  const token = await getToken(CREDENTIALS.REGISTRAR_PUALULA)
  const oya = await getVillageId(token, 'Oya')
  const child = { firstname: word(8), surname: word(8) }
  const motherNid = nid()
  const record = await createBirth(
    token,
    await getBirthDeclaration({
      token,
      partialDeclaration: {
        ...privateHomeIn(oya),
        'child.name': child,
        'mother.nid': motherNid,
        'mother.address': {
          country: 'FAR',
          addressType: AddressType.DOMESTIC,
          administrativeArea: oya
        },
        'informant.phoneNo': phone(),
        'informant.email': email('td06')
      }
    }),
    ActionType.REGISTER
  )
  return {
    title: fullName(child.firstname, child.surname),
    motherNid,
    trackingId: record.trackingId as string
  }
}

/**
 * TD-07 (G): draft by f.katongo (not sent). The existing helper uses a
 * random faker name, and returns it as the record title.
 */
export async function createDraftRecord() {
  const token = await getToken(CREDENTIALS.REGISTRATION_OFFICER)
  return { title: await createBirthDraftViaApi(token) }
}

/** TD-08 (H): registered by k.mweene, then sealed by c.lungu. */
export async function createSealedRecord() {
  const registrarToken = await getToken(CREDENTIALS.REGISTRAR)
  const child = { firstname: word(8), surname: word(10) }
  const record = await createBirth(
    registrarToken,
    await getBirthDeclaration({
      token: registrarToken,
      partialDeclaration: {
        'child.name': child,
        'informant.phoneNo': phone(),
        'informant.email': email('td08')
      }
    }),
    ActionType.REGISTER
  )

  const generalToken = await getToken(CREDENTIALS.REGISTRAR_GENERAL)
  await customActionViaApi({
    token: generalToken,
    eventId: record.eventId,
    customActionType: 'SEAL',
    annotation: {
      reason: 'COURT_ORDER',
      courtOrderReference: `CO-${faker.string.numeric(6)}`,
      courtOrderCopy: await uploadFile(getSignatureFile(), generalToken)
    }
  })

  return {
    title: fullName(child.firstname, child.surname),
    trackingId: record.trackingId as string
  }
}

/** TD-09 (I): declared by f.katongo, then archived by f.katongo. */
export async function createArchivedRecord() {
  const token = await getToken(CREDENTIALS.REGISTRATION_OFFICER)
  const child = { firstname: word(8), surname: word(10) }
  const motherNid = nid()
  const record = await createBirth(
    token,
    await getBirthDeclaration({
      token,
      partialDeclaration: {
        'child.name': child,
        'mother.nid': motherNid,
        'informant.phoneNo': phone(),
        'informant.email': email('td09')
      }
    }),
    ActionType.DECLARE
  )
  await archiveViaApi(token, record.eventId)
  return {
    title: fullName(child.firstname, child.surname),
    motherNid,
    trackingId: record.trackingId as string
  }
}
