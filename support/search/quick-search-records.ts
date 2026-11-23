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
import { ActionType, QueryType } from '@opencrvs/toolkit/events'
import { CREDENTIALS, GATEWAY_HOST } from '@support/constants'
import { getToken } from '@support/helpers'
import {
  createDeclaration as createBirth,
  getDeclaration as getBirthDeclaration
} from '@support/test-data/birth-declaration'
import { createDeclaration as createDeath } from '@support/test-data/death-declaration'

/*
 * Test data for quick search (TestRail C2491). Each test in
 * quick-search-options.spec.ts creates only the records that it needs:
 * - ID test: a registered record (createIdRecord).
 * - Name test: TD-01, TD-02 and TD-04 (createNameRecords).
 * - Short-name test: TD-03 (createShortNameRecord).
 * - Extra checks: a birth record and a death record, TD-05
 *   (createExtraCheckRecords).
 * The TD numbers are the records in the test data workbook
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
// Rare letters (no vowels) for the short names. A word of these letters is
// not a real name, so few other records are within 1 edit of it.
// 8 letters give 64 two-letter names and 4,096 four-letter names.
const RARE = 'jkqvwxyz'

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
function editDistance(a: string, b: string) {
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

/**
 * Builds names with `build` until `check` finds no problem. `check`
 * returns the reason why the names do not give the planned distances.
 */
function buildChecked<T>(
  build: () => T,
  check: (names: T) => string | undefined
): T {
  for (let attempt = 0; attempt < 200; attempt++) {
    const names = build()
    if (!check(names)) return names
  }
  throw new Error(
    'Could not build quick search names with the planned distances'
  )
}

type DistanceRule = [string, string, (distance: number) => boolean]

function firstFailedRule(rules: DistanceRule[]) {
  for (const [term, name, ok] of rules) {
    const distance = editDistance(term, name)
    if (!ok(distance)) return `${term} -> ${name} = ${distance}`
  }
  return undefined
}

/**
 * Names for the name test: TD-01 (A), TD-02 (B, 1 edit from A in each
 * child, father and informant name) and TD-04 (D, 3 edits from A in each
 * child name). Also the fuzzy search words that are made from A's names.
 */
function buildLongNames() {
  const childFirst = word(9)
  const childSurname = word(10)
  const fatherFirst = word(6)
  const fatherSurname = word(9)
  const informantFirst = word(6)
  const informantSurname = word(8)
  const motherFirst = word(8)
  // The part after the hyphen has 4 rare letters, so it is not a real name.
  const motherSurnameEnd = rareWord(4)
  const motherSurname = `${word(8)}-${motherSurnameEnd}`

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
    b: {
      // Unrelated mother, so that dedup does not flag the record (every
      // dedup rule needs a similar mother).
      motherFirst: word(6),
      motherSurname: word(9),
      childFirst: substitute(childFirst, [8]),
      childSurname: childSurname.slice(0, 3) + childSurname.slice(4),
      fatherFirst: substitute(fatherFirst, [0]),
      fatherSurname: substitute(fatherSurname, [4]),
      informantFirst: informantFirst + pick(CONSONANTS),
      informantSurname: informantSurname + pick(CONSONANTS)
    },
    d: {
      motherFirst: word(8),
      motherSurname: word(8),
      childFirst: substitute(childFirst, [1, 4, 6]),
      childSurname: substitute(childSurname, [2, 5, 8])
    },
    terms: {
      // More than 5 letters, 2 edits: matches A only
      twoSwaps: swap(childFirst, [2, 5]),
      twoSubstitutions: substitute(childFirst, [1, 7]),
      // 3-5 letters, 1 edit: matches A
      surnameEndSwap: swap(motherSurnameEnd, [1]),
      unusedName: word(11)
    }
  }
}

type LongNames = ReturnType<typeof buildLongNames>

function checkLongNames(n: LongNames): string | undefined {
  const failed = firstFailedRule([
    [n.a.childFirst, n.b.childFirst, (d) => d === 1],
    [n.a.childSurname, n.b.childSurname, (d) => d === 1],
    [n.a.fatherFirst, n.b.fatherFirst, (d) => d === 1],
    [n.a.fatherSurname, n.b.fatherSurname, (d) => d === 1],
    [n.a.informantFirst, n.b.informantFirst, (d) => d === 1],
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
    [n.terms.surnameEndSwap, n.a.motherSurnameEnd, (d) => d === 1]
  ])
  if (failed) return failed

  // Each TD-01 name must match only its own field: every TD-01, TD-02 and
  // TD-04 name of another field is at least 3 edits away. TD-02 and TD-04
  // mothers are unrelated to every TD-01 name.
  const fields: [string, string[]][] = [
    ['childFirst', [n.a.childFirst, n.b.childFirst, n.d.childFirst]],
    ['childSurname', [n.a.childSurname, n.b.childSurname, n.d.childSurname]],
    ['fatherFirst', [n.a.fatherFirst, n.b.fatherFirst]],
    ['fatherSurname', [n.a.fatherSurname, n.b.fatherSurname]],
    ['informantFirst', [n.a.informantFirst, n.b.informantFirst]],
    ['informantSurname', [n.a.informantSurname, n.b.informantSurname]],
    ['motherFirst', [n.a.motherFirst]],
    ['motherSurname', n.a.motherSurname.split('-')],
    ['bMother', [n.b.motherFirst, n.b.motherSurname]],
    ['dMother', [n.d.motherFirst, n.d.motherSurname]]
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

  // The fuzzy search words must match TD-01 only: every TD-02 and TD-04
  // name, and every other TD-01 name, is at least 3 edits away.
  const allNames = fields.flatMap(([, values]) => values)
  const termTargets: [string, string][] = [
    [n.terms.twoSwaps, n.a.childFirst],
    [n.terms.twoSubstitutions, n.a.childFirst],
    [n.terms.surnameEndSwap, n.a.motherSurnameEnd]
  ]
  for (const [term, target] of termTargets) {
    for (const name of allNames) {
      if (name !== target && editDistance(term, name) < 3) {
        return `${term} is near ${name}`
      }
    }
  }
  return undefined
}

/**
 * Names for the short-name test: TD-03 (C) with a 2-letter child name, a
 * 4-letter mother name and a 9-letter mother surname, and the fuzzy search
 * words that are made from them.
 */
function buildShortNames() {
  const childFirst = rareWord(2)
  const motherFirst = rareWord(4)
  const motherSurname = word(9)
  return {
    c: { childFirst, childSurname: word(10), motherFirst, motherSurname },
    terms: {
      // More than 5 letters: 2 edits match, 3 edits do not
      motherSurnameTwoEdits: substitute(motherSurname, [7, 8]),
      motherSurnameThreeEdits: substitute(motherSurname, [2, 5, 8]),
      motherFirstPlusTwo: motherFirst + pick(RARE) + pick(RARE),
      // 3-5 letters: 1 edit matches
      motherFirstOneEdit: substitute(motherFirst, [3]),
      motherFirstPlusOne: motherFirst + pick(RARE),
      childFirstPlusOne: childFirst + pick(RARE),
      // 3-5 letters: 2 edits do not match
      motherFirstTwoEdits: substitute(motherFirst, [2, 3]),
      motherFirstFiveTwoEdits:
        substitute(motherFirst, [1]).slice(0, 3) +
        pick(RARE) +
        motherFirst.slice(3),
      // 1-2 letters: 1 edit does not match
      childFirstOneEdit: substitute(childFirst, [1])
    }
  }
}

type ShortNames = ReturnType<typeof buildShortNames>

function checkShortNames(n: ShortNames): string | undefined {
  if (n.terms.motherFirstFiveTwoEdits.length !== 5) return 'length'
  return firstFailedRule([
    [n.terms.motherSurnameTwoEdits, n.c.motherSurname, (d) => d === 2],
    [n.terms.motherSurnameThreeEdits, n.c.motherSurname, (d) => d === 3],
    [n.terms.motherFirstPlusTwo, n.c.motherFirst, (d) => d === 2],
    [n.terms.motherFirstOneEdit, n.c.motherFirst, (d) => d === 1],
    [n.terms.motherFirstPlusOne, n.c.motherFirst, (d) => d === 1],
    [n.terms.childFirstPlusOne, n.c.childFirst, (d) => d === 1],
    [n.terms.motherFirstTwoEdits, n.c.motherFirst, (d) => d === 2],
    [n.terms.motherFirstFiveTwoEdits, n.c.motherFirst, (d) => d === 2],
    [n.terms.childFirstOneEdit, n.c.childFirst, (d) => d === 1]
  ])
}

const buildLongNameSet = () => buildChecked(buildLongNames, checkLongNames)
const buildShortNameSet = () => buildChecked(buildShortNames, checkShortNames)

const nid = () => faker.string.numeric(10)
const phone = () => `07${faker.string.numeric(8)}`
const email = (label: string) =>
  `${label}.${faker.string.alpha({ length: 6, casing: 'lower' })}@example.com`

const fullName = (first: string, surname: string) => `${first} ${surname}`

/**
 * Makes an invalid tracking ID or registration number: the last 3
 * characters become other digits. Quick search also searches the word as a
 * fuzzy name (up to 2 edits), and names have only letters, so 3 digits keep
 * the word at least 3 edits from every name.
 */
export function invalidId(value: string) {
  let result = value.slice(0, -3)
  for (const current of value.slice(-3)) {
    let next = pick('0123456789')
    while (next === current) next = pick('0123456789')
    result += next
  }
  return result
}

/** Changes the last character to another character of the same kind. */
export function changeLastCharacter(value: string) {
  const last = value.slice(-1)
  const pool = /\d/.test(last) ? '0123456789' : 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  let next = pick(pool)
  while (next === last) next = pick(pool)
  return value.slice(0, -1) + next
}

/**
 * The ID test record, registered by k.mweene: it has a tracking ID, a
 * registration number, a mother NID, an informant phone and an email.
 */
export async function createIdRecord() {
  const token = await getToken(CREDENTIALS.REGISTRAR)
  const child = { firstname: word(8), surname: word(10) }
  const values = { motherNid: nid(), phone: phone(), email: email('idrecord') }
  const record = await createBirth(
    token,
    await getBirthDeclaration({
      token,
      partialDeclaration: {
        'child.name': child,
        'mother.nid': values.motherNid,
        'informant.phoneNo': values.phone,
        'informant.email': values.email
      }
    }),
    ActionType.REGISTER
  )
  return {
    ...values,
    eventType: 'birth',
    title: fullName(child.firstname, child.surname),
    trackingId: record.trackingId as string,
    registrationNumber: record.registrationNumber
  }
}

/**
 * The name test records, declared by f.katongo:
 * - TD-01 (A): every name field has its own name.
 * - TD-02 (B): 1 edit from A in every child, father and informant name,
 *   and an unrelated mother.
 * - TD-04 (D): 3 edits from A in each child name. Must not match.
 */
export async function createNameRecords() {
  const names = buildLongNameSet()
  const token = await getToken(CREDENTIALS.REGISTRATION_OFFICER)
  const fatherDetails = {
    'father.detailsNotAvailable': false,
    'father.nationality': 'FAR',
    'father.idType': 'NATIONAL_ID',
    'father.addressSameAs': 'YES'
  }

  const tdA = await createBirth(
    token,
    await getBirthDeclaration({
      token,
      informantRelation: 'BROTHER',
      partialDeclaration: {
        ...fatherDetails,
        'child.name': {
          firstname: names.a.childFirst,
          surname: names.a.childSurname
        },
        'mother.name': {
          firstname: names.a.motherFirst,
          surname: names.a.motherSurname
        },
        'father.name': {
          firstname: names.a.fatherFirst,
          surname: names.a.fatherSurname
        },
        'father.dob': '1993-07-22',
        'father.nid': nid(),
        'informant.name': {
          firstname: names.a.informantFirst,
          surname: names.a.informantSurname
        },
        'informant.dob': '2006-05-30',
        'informant.phoneNo': phone(),
        'informant.email': email('td01')
      }
    }),
    ActionType.DECLARE
  )

  const tdB = await createBirth(
    token,
    await getBirthDeclaration({
      token,
      informantRelation: 'BROTHER',
      partialDeclaration: {
        ...fatherDetails,
        'child.name': {
          firstname: names.b.childFirst,
          surname: names.b.childSurname
        },
        'mother.name': {
          firstname: names.b.motherFirst,
          surname: names.b.motherSurname
        },
        'mother.dob': '1988-01-09',
        'father.name': {
          firstname: names.b.fatherFirst,
          surname: names.b.fatherSurname
        },
        'father.dob': '1987-05-03',
        'father.nid': nid(),
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

  const tdD = await createBirth(
    token,
    await getBirthDeclaration({
      token,
      partialDeclaration: {
        'child.name': {
          firstname: names.d.childFirst,
          surname: names.d.childSurname
        },
        'mother.name': {
          firstname: names.d.motherFirst,
          surname: names.d.motherSurname
        },
        'informant.phoneNo': phone(),
        'informant.email': email('td04')
      }
    }),
    ActionType.DECLARE
  )

  return {
    names,
    a: {
      eventType: 'birth',
      title: fullName(names.a.childFirst, names.a.childSurname),
      trackingId: tdA.trackingId as string
    },
    b: {
      eventType: 'birth',
      title: fullName(names.b.childFirst, names.b.childSurname),
      trackingId: tdB.trackingId as string
    },
    d: {
      eventType: 'birth',
      title: fullName(names.d.childFirst, names.d.childSurname),
      trackingId: tdD.trackingId as string
    }
  }
}

/** The short-name test record (TD-03), declared by f.katongo. */
export async function createShortNameRecord() {
  const names = buildShortNameSet()
  const token = await getToken(CREDENTIALS.REGISTRATION_OFFICER)
  const record = await createBirth(
    token,
    await getBirthDeclaration({
      token,
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
  return {
    names,
    c: {
      eventType: 'birth',
      title: fullName(names.c.childFirst, names.c.childSurname),
      trackingId: record.trackingId as string
    }
  }
}

/**
 * The records for the extra checks (not in TestRail C2491), declared by
 * f.katongo: a birth with a mother, father and informant NID and an email,
 * and a death (TD-05) whose surname is used in a full-name search.
 */
export async function createExtraCheckRecords() {
  const token = await getToken(CREDENTIALS.REGISTRATION_OFFICER)
  const child = { firstname: word(9), surname: word(10) }
  const values = {
    motherNid: nid(),
    fatherNid: nid(),
    informantNid: nid(),
    email: email('extra')
  }
  const birth = await createBirth(
    token,
    await getBirthDeclaration({
      token,
      informantRelation: 'BROTHER',
      partialDeclaration: {
        'child.name': child,
        'mother.nid': values.motherNid,
        'father.detailsNotAvailable': false,
        'father.name': { firstname: word(6), surname: word(9) },
        'father.dob': '1993-07-22',
        'father.nationality': 'FAR',
        'father.idType': 'NATIONAL_ID',
        'father.nid': values.fatherNid,
        'father.addressSameAs': 'YES',
        'informant.name': { firstname: word(6), surname: word(8) },
        'informant.dob': '2006-05-30',
        'informant.nid': values.informantNid,
        'informant.phoneNo': phone(),
        'informant.email': values.email
      }
    }),
    ActionType.DECLARE
  )

  const deceased = { firstname: word(7), surname: word(9) }
  const death = await createDeath(
    token,
    {
      'deceased.name': deceased,
      'deceased.nid': nid(),
      'spouse.name': { firstname: word(7), surname: deceased.surname },
      'informant.phoneNo': phone(),
      'informant.email': email('td05')
    },
    ActionType.DECLARE
  )

  return {
    birth: {
      ...values,
      childFirst: child.firstname,
      eventType: 'birth',
      title: fullName(child.firstname, child.surname),
      trackingId: birth.trackingId as string
    },
    death: {
      eventType: 'death',
      surname: deceased.surname,
      title: fullName(deceased.firstname, deceased.surname),
      trackingId: death.trackingId as string
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
          const query: QueryType = {
            type: 'and',
            clauses: [
              { eventType, trackingId: { type: 'exact', term: trackingId } }
            ]
          }
          const result = await client.event.search.query({ query })
          return result.total
        },
        {
          message: `Search does not find ${eventType} ${trackingId}`,
          timeout: 60_000
        }
      )
      .toBeGreaterThan(0)
  }
}
