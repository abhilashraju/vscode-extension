// @ts-check
'use strict';

/**
 * @typedef {{t: 'c', o: number, n: number, text: string}
 *   | {t: 'd', o: number, text: string}
 *   | {t: 'a', n: number, text: string}
 *   | {t: 's', count: number}} DiffRow
 */

const CONTEXT_LINES = 3;

/**
 * Convert the "content" blocks of a Gerrit file diff (ab / a / b / skip) into rows
 * with old/new line numbers. Long unchanged stretches are collapsed to CONTEXT_LINES
 * lines around each change, whatever context the server applied.
 *   c = unchanged, d = deleted, a = added, s = collapsed unchanged lines
 * @param {Array<any>} content
 * @param {number} [maxRows]
 * @returns {{rows: DiffRow[], truncated: boolean}}
 */
function parseDiff(content, maxRows = 3000) {
    /** @type {DiffRow[]} */
    const rows = [];
    let oldNo = 1;
    let newNo = 1;
    const blocks = Array.isArray(content) ? content : [];

    /** @param {number} count */
    const skip = (count) => {
        if (count > 0) {
            rows.push({ t: 's', count });
            oldNo += count;
            newNo += count;
        }
    };

    for (let i = 0; i < blocks.length; i++) {
        if (rows.length >= maxRows) {
            return { rows, truncated: true };
        }
        const b = blocks[i];
        if (b && typeof b.skip === 'number') {
            skip(b.skip);
        } else if (b && Array.isArray(b.ab)) {
            const lines = b.ab;
            const head = i === 0 ? 0 : CONTEXT_LINES;
            const tail = i === blocks.length - 1 ? 0 : CONTEXT_LINES;
            if (lines.length <= head + tail) {
                for (const text of lines) {
                    rows.push({ t: 'c', o: oldNo++, n: newNo++, text: String(text) });
                }
            } else {
                for (let k = 0; k < head; k++) {
                    rows.push({ t: 'c', o: oldNo++, n: newNo++, text: String(lines[k]) });
                }
                skip(lines.length - head - tail);
                for (let k = lines.length - tail; k < lines.length; k++) {
                    rows.push({ t: 'c', o: oldNo++, n: newNo++, text: String(lines[k]) });
                }
            }
        } else if (b) {
            for (const text of Array.isArray(b.a) ? b.a : []) {
                rows.push({ t: 'd', o: oldNo++, text: String(text) });
            }
            for (const text of Array.isArray(b.b) ? b.b : []) {
                rows.push({ t: 'a', n: newNo++, text: String(text) });
            }
        }
    }
    if (rows.length > maxRows) {
        return { rows: rows.slice(0, maxRows), truncated: true };
    }
    return { rows, truncated: false };
}

module.exports = { parseDiff, CONTEXT_LINES };
