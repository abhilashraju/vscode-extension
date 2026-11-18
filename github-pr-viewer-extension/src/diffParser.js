// @ts-check
'use strict';

/**
 * @typedef {{t: 'h' | 'n', text: string} | {t: 'a', n: number, text: string} | {t: 'd', o: number, text: string} | {t: 'c', o: number, n: number, text: string}} DiffRow
 */

/**
 * Parse a unified-diff patch (as returned by the GitHub "files" API) into rows
 * with old/new line numbers.
 *   h = hunk header, a = added, d = deleted, c = context, n = "\ No newline" marker
 * @param {string} patch
 * @param {number} [maxRows]
 * @returns {{rows: DiffRow[], truncated: boolean}}
 */
function parsePatch(patch, maxRows = 3000) {
    /** @type {DiffRow[]} */
    const rows = [];
    let oldNo = 0;
    let newNo = 0;
    const lines = String(patch).split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    for (const line of lines) {
        if (rows.length >= maxRows) {
            return { rows, truncated: true };
        }
        if (line.startsWith('@@')) {
            const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
            if (m) {
                oldNo = Number(m[1]);
                newNo = Number(m[2]);
            }
            rows.push({ t: 'h', text: line });
        } else if (line.startsWith('\\')) {
            rows.push({ t: 'n', text: line });
        } else if (line.startsWith('+')) {
            rows.push({ t: 'a', n: newNo++, text: line.slice(1) });
        } else if (line.startsWith('-')) {
            rows.push({ t: 'd', o: oldNo++, text: line.slice(1) });
        } else {
            rows.push({ t: 'c', o: oldNo++, n: newNo++, text: line.slice(1) });
        }
    }
    return { rows, truncated: false };
}

module.exports = { parsePatch };
