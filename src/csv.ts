/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import type { HistorySample } from "./history";

const quote = (field: string): string => /[",\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;

// recorded history as CSV: ISO 8601 time and value in display units, empty when nothing was recorded
export const historyCsv = (name: string, samples: HistorySample[], unit: string): string => {
    const header = ["time", quote(unit ? `${name} (${unit})` : name)].join(",");
    const rows = samples.map(s => `${new Date(s.t).toISOString()},${s.v === null ? "" : s.v}`);
    return [header, ...rows].join("\n") + "\n";
};
