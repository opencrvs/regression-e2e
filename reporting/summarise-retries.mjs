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

/**
 * Summarises the retries that retry-reporter.ts records.
 *
 *   node reporting/summarise-retries.mjs retries/retries.json
 *
 * Writes a table to the job summary, a warning annotation with the totals,
 * and a `slack` step output. The output is empty when no test needed a retry.
 *
 * This is a copy of packages/testland/e2e/summarise-retries.mjs in
 * opencrvs-core, without the shards. Plain .mjs, so that it runs on Node
 * with no install.
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const SLACK_TOP = 5

const file = process.argv[2]
const tests =
  file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []

tests.sort((a, b) => b.retryCostMs - a.retryCostMs)

const seconds = (ms) => `${Math.round(ms / 1000)}s`
const displayOutcome = (test) =>
  test.outcome === 'unexpected' ? 'failed' : test.outcome
// An error can quote markup like `<li disabled>`. Slack mrkdwn also uses
// these characters as control characters.
const escapeMarkup = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const retryCostMs = tests.reduce((sum, test) => sum + test.retryCostMs, 0)
const flaky = tests.filter((test) => test.outcome === 'flaky').length
const headline =
  `${tests.length} test(s) needed a retry (${flaky} flaky), ` +
  `${seconds(retryCostMs)} spent beyond a single attempt`

writeSummary()
writeSlackOutput()

if (tests.length > 0) {
  process.stdout.write(`::warning title=Retries::${headline}\n`)
}

function writeSummary() {
  if (!process.env.GITHUB_STEP_SUMMARY) return

  if (tests.length === 0) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      'No test needed a retry ✨\n'
    )
    return
  }

  const escapeCell = (text) => escapeMarkup(text).replace(/\|/g, '\\|')

  const rows = tests.map((test) =>
    [
      escapeCell(`${test.file}:${test.line} › ${test.title}`),
      displayOutcome(test),
      test.attempts.map(({ status }) => status).join(' → '),
      seconds(test.retryCostMs),
      escapeCell(test.firstError)
    ].join(' | ')
  )

  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '## Retries',
      '',
      `${headline}.`,
      '',
      'Test | Outcome | Attempts | Lost | First error',
      '--- | --- | --- | --- | ---',
      ...rows,
      ''
    ].join('\n')
  )
}

function writeSlackOutput() {
  if (!process.env.GITHUB_OUTPUT) return

  const lines =
    tests.length === 0
      ? []
      : [
          `⚠️ ${headline}:`,
          ...tests
            .slice(0, SLACK_TOP)
            .map(
              (test) =>
                `• \`${escapeMarkup(path.basename(test.file))}\` ${escapeMarkup(test.title)} — ${displayOutcome(test)}, ${seconds(test.retryCostMs)}`
            ),
          ...(tests.length > SLACK_TOP
            ? [`…and ${tests.length - SLACK_TOP} more in the run summary`]
            : [])
        ]

  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `slack<<RETRIES_EOF\n${lines.join('\n')}\nRETRIES_EOF\n`
  )
}
