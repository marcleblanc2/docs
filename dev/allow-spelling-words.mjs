#!/usr/bin/env node

/**
 * Adds words to cspell-allow-list.txt, in alphabetical order in its "# Words"
 * section. Words CSpell already accepts, from its dictionaries or the allow
 * list, are left out, so the list only grows by what it needs. Reports what
 * was added, what was already accepted, and what was ignored for not being a
 * word. Needs CSpell on the PATH: npm install --global cspell@10
 *
 * Usage: node dev/allow-spelling-words.mjs <words…>
 *
 * The words may be separated by spaces or commas and wrapped in the backticks
 * the spell check report puts around them. The text may also be the body of a
 * `/spell <words>` or `/spell allow <words>` pull request comment, as sent by
 * .github/workflows/spellcheck-allow.yml; only its first line is read.
 */

import {spawnSync} from 'child_process';
import {readFileSync, writeFileSync} from 'fs';

const ALLOW_LIST = 'cspell-allow-list.txt';
const WORDS_SECTION = '# Words';
// CSpell checks the parts of hyphenated and snake_case words separately, so
// the allow list holds plain words
const WORD_PATTERN = /^[\p{L}\p{N}']+$/u;

// The order dev/check-spelling.mjs enforces, which is also how CSpell matches
const collator = new Intl.Collator('en', {sensitivity: 'base'});

function requestedWords(text) {
	const words = text
		.split('\n')[0]
		.replace(/^\s*\/spell(\s+allow)?(?=\s|$)/, '')
		.split(/[\s,]+/)
		.map(word => word.replace(/^[`'"]+|[`'"]+$/g, ''))
		.filter(Boolean);
	return words.filter(
		(word, index) =>
			words.findIndex(other => collator.compare(other, word) === 0) ===
			index
	);
}

// The words CSpell flags when given one per line, under the repository's
// cspell.json; the others it already accepts
function unknownWords(words) {
	if (words.length === 0) {
		return [];
	}
	const result = spawnSync(
		'cspell',
		[
			'--no-progress',
			'--reporter',
			'@cspell/cspell-json-reporter',
			'stdin'
		],
		{encoding: 'utf8', input: words.join('\n') + '\n'}
	);
	if (result.error) {
		throw result.error;
	}
	const report = JSON.parse(result.stdout);
	if (![0, 1].includes(result.status) || report.error.length > 0) {
		throw new Error(result.stderr || JSON.stringify(report.error));
	}
	const flaggedRows = new Set(report.issues.map(issue => issue.row));
	return words.filter((word, index) => flaggedRows.has(index + 1));
}

// An entry may carry a trailing comment, e.g. `argjson # jq option`
const entryOf = line => line.replace(/\s*#.*/, '').trim();

// Inserts the words into the "# Words" section, which runs from its heading to
// the next blank or comment line, keeping it sorted. Returns the new lines.
function withWords(lines, words) {
	const start = lines.indexOf(WORDS_SECTION) + 1;
	if (start === 0) {
		throw new Error(`${ALLOW_LIST} has no "${WORDS_SECTION}" section`);
	}
	const result = [...lines];
	for (const word of words) {
		let index = start;
		while (
			index < result.length &&
			!/^\s*(#|$)/.test(result[index]) &&
			collator.compare(entryOf(result[index]), word) < 0
		) {
			index++;
		}
		result.splice(index, 0, word);
	}
	return result;
}

function main() {
	const requested = requestedWords(process.argv.slice(2).join(' '));
	const ignored = requested.filter(word => !WORD_PATTERN.test(word));
	const candidates = requested.filter(word => WORD_PATTERN.test(word));
	const added = unknownWords(candidates);
	const alreadyAccepted = candidates.filter(word => !added.includes(word));

	if (added.length > 0) {
		const lines = readFileSync(ALLOW_LIST, 'utf8').split('\n');
		writeFileSync(ALLOW_LIST, withWords(lines, added).join('\n'));
	}

	const report = [
		['Added', added],
		['Already accepted', alreadyAccepted],
		['Not a word, ignored', ignored]
	].filter(([, words]) => words.length > 0);
	if (report.length === 0) {
		console.log('No words given.');
	}
	for (const [label, words] of report) {
		console.log(`${label}: ${words.map(word => `\`${word}\``).join(', ')}`);
	}
}

main();
