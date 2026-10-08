/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { EmptyState, EmptyStateActions, EmptyStateBody, EmptyStateFooter } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { ToggleGroup, ToggleGroupItem } from "@patternfly/react-core/dist/esm/components/ToggleGroup/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { ChartLineIcon } from "@patternfly/react-icons/dist/esm/icons/chart-line-icon.js";
import { DownloadIcon } from "@patternfly/react-icons/dist/esm/icons/download-icon.js";
import cockpit from "cockpit";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as timeformat from "timeformat";

import { historyRanges, loadHistory, LOG_INTERVAL_MS } from "./history";
import type { HistoryRange, HistorySample, HistoryStatus } from "./history";
import { formatDisplayValue, toDisplayValue, unitLabel } from "./sensors";
import { historyCsv } from "./csv";

const _ = cockpit.gettext;

const HEIGHT = 220;
const MARGIN = { top: 12, right: 16, bottom: 28, left: 72 };

type Threshold = { label: string; value: number; kind: "warning" | "danger" };

const niceStep = (span: number, count: number): number => {
    const raw = span / count;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / magnitude;
    const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return nice * magnitude;
};

const rangeLabel = (range: HistoryRange): string => {
    switch (range.id) {
    case "1h": return _("1 hour");
    case "24h": return _("24 hours");
    default: return _("7 days");
    }
};

const useWidth = (ref: React.RefObject<HTMLDivElement | null>): number => {
    const [width, setWidth] = useState(600);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element)
            return;
        setWidth(element.clientWidth);
        const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    return width;
};

const LineChart = ({ samples, start, end, thresholds, format, timeFormat }: {
    samples: HistorySample[];
    start: number;
    end: number;
    thresholds: Threshold[];
    format: (value: number) => string;
    timeFormat: (t: number) => string;
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const width = useWidth(containerRef);
    const [hover, setHover] = useState<number | null>(null);

    const values = samples.map(s => s.v).filter((v): v is number => v !== null);
    let min = Math.min(...values);
    let max = Math.max(...values);
    // only show limits that are close enough to the data to keep it readable
    const visibleThresholds = thresholds.filter(t => t.value <= max + Math.max(max - min, Math.abs(max) * 0.5, 5));
    visibleThresholds.forEach(t => { min = Math.min(min, t.value); max = Math.max(max, t.value) });
    if (max - min < 1e-9) {
        min -= 1;
        max += 1;
    }
    const step = niceStep(max - min, 4);
    const yMin = Math.floor(min / step) * step;
    const yMax = Math.ceil(max / step) * step;
    const yTicks: number[] = [];
    for (let v = yMin; v <= yMax + step / 2; v += step)
        yTicks.push(v);

    const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 10);
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const x = (t: number) => MARGIN.left + ((t - start) / (end - start)) * plotWidth;
    const y = (v: number) => MARGIN.top + (1 - (v - yMin) / (yMax - yMin)) * plotHeight;

    // split the line at gaps (no value recorded)
    const segments: string[] = [];
    let segment = "";
    for (const sample of samples) {
        if (sample.v === null) {
            if (segment)
                segments.push(segment);
            segment = "";
            continue;
        }
        segment += `${segment ? "L" : "M"}${x(sample.t).toFixed(1)},${y(sample.v).toFixed(1)}`;
    }
    if (segment)
        segments.push(segment);

    const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f => start + f * (end - start));

    const onMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const t = start + ((event.clientX - rect.left - MARGIN.left) / plotWidth) * (end - start);
        let best: number | null = null;
        samples.forEach((sample, i) => {
            if (sample.v !== null && (best === null || Math.abs(sample.t - t) < Math.abs(samples[best].t - t)))
                best = i;
        });
        setHover(best);
    };

    const hovered = hover !== null ? samples[hover] : null;

    return (
        <div className="sensors-chart" ref={containerRef}>
            <svg
                width={width}
                height={HEIGHT}
                role="img"
                onMouseMove={onMouseMove}
                onMouseLeave={() => setHover(null)}
            >
                {yTicks.map(v => (
                    <g key={v}>
                        <line className="sensors-chart-grid" x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(v)} y2={y(v)} />
                        <text className="sensors-chart-axis" x={MARGIN.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle">
                            {format(v)}
                        </text>
                    </g>
                ))}
                {xTicks.map((t, i) => (
                    <text
                        key={t}
                        className="sensors-chart-axis"
                        x={x(t)}
                        y={HEIGHT - 8}
                        textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
                    >
                        {timeFormat(t)}
                    </text>
                ))}
                {visibleThresholds.map(t => (
                    <g key={t.label} className={`sensors-chart-threshold sensors-chart-threshold-${t.kind}`}>
                        <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(t.value)} y2={y(t.value)} />
                        <text x={MARGIN.left + 6} y={y(t.value) - 4} textAnchor="start">
                            {`${t.label} ${format(t.value)}`}
                        </text>
                    </g>
                ))}
                {segments.map(d => <path key={d} className="sensors-chart-line" d={d} />)}
                {hovered && hovered.v !== null &&
                    <g className="sensors-chart-hover">
                        <line x1={x(hovered.t)} x2={x(hovered.t)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} />
                        <circle cx={x(hovered.t)} cy={y(hovered.v)} r={4} />
                    </g>}
            </svg>
            {hovered && hovered.v !== null &&
                <div
                    className="sensors-chart-tooltip"
                    style={{
                        left: Math.min(x(hovered.t) + 12, width - 170),
                        top: Math.max(y(hovered.v) - 48, 0),
                    }}
                >
                    <strong>{format(hovered.v)}</strong>
                    <div>{timeformat.dateTime(hovered.t)}</div>
                </div>}
        </div>
    );
};

const statusMessage = (status: HistoryStatus): string => {
    switch (status) {
    case "no-pcp":
        return _("Sensor history is recorded with Performance Co-Pilot (PCP), which is not installed.");
    case "no-pmda":
        return _("The PCP lm-sensors agent is not enabled.");
    case "no-logger":
        return _("PCP is not recording the sensors.");
    case "no-python":
        return _("The python3-pcp package is missing, so the recorded history cannot be read.");
    case "no-cockpit-pcp":
        return _("The cockpit-pcp package is missing, so Cockpit cannot read the recorded history.");
    default:
        return "";
    }
};

// offer the history as a CSV file to save
const downloadCsv = (fileName: string, csv: string) => {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};

export const HistoryPanel = ({ metric, name, categoryKey, fahrenheit, max, crit, status, onEnable }: {
    metric: string;
    name: string;
    categoryKey: string;
    fahrenheit: boolean;
    max: number | undefined;
    crit: number | undefined;
    status: HistoryStatus;
    onEnable: () => void;
}) => {
    const [range, setRange] = useState<HistoryRange>(historyRanges[0]);
    const [samples, setSamples] = useState<HistorySample[] | null>(null);
    const [timeWindow, setTimeWindow] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (status !== "enabled")
            return;

        let cancelled = false;
        const load = () => {
            const end = Date.now();
            loadHistory(metric, range)
                    .then(result => {
                        if (cancelled)
                            return;
                        setTimeWindow({ start: end - range.durationMs, end });
                        setSamples(result);
                        setError(null);
                    })
                    .catch((err: Error) => {
                        if (!cancelled)
                            // the metrics channel is missing without python3-pcp (or cockpit-pcp before Cockpit 326)
                            setError(err.message === "not-supported"
                                ? _("Cockpit cannot read PCP archives. Install the python3-pcp package (and cockpit-pcp on Cockpit older than 326).")
                                : err.message);
                    });
        };

        setSamples(null);
        load();
        const timer = setInterval(load, LOG_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [metric, range, status]);

    if (status === "loading")
        return <Spinner size="lg" />;

    if (status !== "enabled") {
        return (
            <EmptyState headingLevel="h4" icon={ChartLineIcon} titleText={_("Sensor history is not enabled")} variant="sm">
                <EmptyStateBody>
                    {statusMessage(status)}
                    {" "}
                    {_("Enabling it installs PCP if needed and records all sensors every minute.")}
                </EmptyStateBody>
                <EmptyStateFooter>
                    <EmptyStateActions>
                        <Button variant="secondary" onClick={onEnable}>{_("Enable history")}</Button>
                    </EmptyStateActions>
                </EmptyStateFooter>
            </EmptyState>
        );
    }

    const display = samples?.map(s => ({ t: s.t, v: s.v === null ? null : toDisplayValue(categoryKey, s.v, fahrenheit) })) ?? [];
    const values = display.map(s => s.v).filter((v): v is number => v !== null);
    const format = (v: number) => formatDisplayValue(categoryKey, v, fahrenheit);
    const thresholds: Threshold[] = [];
    if (typeof max === "number" && max !== 0)
        thresholds.push({ label: _("max"), value: toDisplayValue(categoryKey, max, fahrenheit), kind: "warning" });
    if (typeof crit === "number" && crit !== 0)
        thresholds.push({ label: _("crit"), value: toDisplayValue(categoryKey, crit, fahrenheit), kind: "danger" });

    const timeFormat = range.durationMs > 24 * 60 * 60 * 1000
        ? (t: number) => timeformat.formatter({ month: "short", day: "numeric" }).format(t)
        : (t: number) => timeformat.time(t);

    let body;
    if (error) {
        body = <Alert isInline isPlain variant="warning" title={_("Could not load the sensor history")}>{error}</Alert>;
    } else if (samples === null) {
        body = <Spinner size="lg" />;
    } else if (values.length === 0) {
        body = (
            <EmptyState headingLevel="h4" icon={ChartLineIcon} titleText={_("No history yet")} variant="sm">
                <EmptyStateBody>
                    {_("Sensors are recorded every minute; the first values appear shortly.")}
                </EmptyStateBody>
            </EmptyState>
        );
    } else {
        body = (
            <>
                <LineChart
                    samples={display}
                    start={timeWindow.start}
                    end={timeWindow.end}
                    thresholds={thresholds}
                    format={format}
                    timeFormat={timeFormat}
                />
                <Flex className="sensors-history-summary" spaceItems={{ default: "spaceItemsLg" }}>
                    <FlexItem>{cockpit.format(_("Minimum: $0"), format(Math.min(...values)))}</FlexItem>
                    <FlexItem>{cockpit.format(_("Average: $0"), format(values.reduce((a, b) => a + b, 0) / values.length))}</FlexItem>
                    <FlexItem>{cockpit.format(_("Maximum: $0"), format(Math.max(...values)))}</FlexItem>
                </Flex>
            </>
        );
    }

    return (
        <div className="sensors-history">
            <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
                <ToggleGroup isCompact aria-label={_("History range")}>
                    {historyRanges.map(r => (
                        <ToggleGroupItem
                            key={r.id}
                            text={rangeLabel(r)}
                            buttonId={`history-range-${metric}-${r.id}`}
                            isSelected={r.id === range.id}
                            onChange={() => setRange(r)}
                        />
                    ))}
                </ToggleGroup>
                <Button
                    variant="link"
                    icon={<DownloadIcon />}
                    isDisabled={values.length === 0}
                    onClick={() => downloadCsv(`${metric}-${range.id}.csv`, historyCsv(name, display, unitLabel(categoryKey, fahrenheit)))}
                >
                    {_("Export CSV")}
                </Button>
            </Flex>
            {body}
        </div>
    );
};
