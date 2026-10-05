/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import cockpit from "cockpit";
import React from "react";

import type { Trend } from "./trend";

const _ = cockpit.gettext;

const WIDTH = 72;
const HEIGHT = 20;

// the recent readings (up to TREND_SAMPLES) of a sensor as a small line, with the lowest and highest reading of this session
export const Sparkline = ({ trend, convert, format }: {
    trend: Trend;
    convert: (value: number) => number;
    format: (value: number) => string;
}) => {
    const values = trend.values.map(convert);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;
    const step = WIDTH / Math.max(values.length - 1, 1);
    const y = (v: number) => span ? HEIGHT - 2 - ((v - min) / span) * (HEIGHT - 4) : HEIGHT / 2;
    const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`
    ).join(" ");

    return (
        <Tooltip content={_("Readings since this page was opened: lowest – highest")}>
            <span className="sensors-sparkline">
                <svg width={WIDTH} height={HEIGHT} aria-hidden="true">
                    {values.length > 1 && <polyline points={points} />}
                </svg>
                <span className="sensors-sparkline-range">
                    {`${format(convert(trend.min))} – ${format(convert(trend.max))}`}
                </span>
            </span>
        </Tooltip>
    );
};
