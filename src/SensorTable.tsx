/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { ActionsColumn, ExpandableRowContent, Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table/dist/esm/components/Table/index.js";
import cockpit from "cockpit";
import React from "react";

import { HistoryPanel } from "./HistoryChart";
import { hasHistory, pcpMetricName } from "./history";
import {
    extractSensorGroup, formatDisplayValue, formatSensorKey, formatSensorValue, getSubFeature, isFlagKey,
    formatReasons, subFeatureLabel, toDisplayValue
} from "./sensors";
import type { SensorCategory, SensorChipGroup, SensorStatus } from "./sensors";
import { Sparkline } from "./Sparkline";
import { sensorKey } from "./trend";
import { isVisible, matchesFilter, useSensorView } from "./view";

const _ = cockpit.gettext;

export const StatusLabel = ({ status, categoryKey, fahrenheit, muted }: {
    status: SensorStatus;
    categoryKey: string;
    fahrenheit: boolean;
    muted: boolean;
}) => {
    const reasons = formatReasons(categoryKey, status, fahrenheit);
    const levelText = status.level === "critical" ? _("Critical") : _("Warning");

    if (muted) {
        const label = <Label isCompact variant="outline">{_("Alerts ignored")}</Label>;
        return status.level === "ok"
            ? label
            : <Tooltip content={`${levelText}: ${reasons}`}>{label}</Tooltip>;
    }
    if (status.level === "ok")
        return <Label isCompact variant="outline" status="success">{_("Normal")}</Label>;

    return (
        <Tooltip content={reasons}>
            <Label isCompact status={status.level === "critical" ? "danger" : "warning"}>{levelText}</Label>
        </Tooltip>
    );
};

// a sensor or chip label, with its original name when the user renamed it
export const SensorName = ({ name, alias, hidden }: { name: string; alias: string | undefined; hidden: boolean }) => (
    <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }}>
        <span>{alias || name}</span>
        {alias && <span className="sensors-original-name">{name}</span>}
        {hidden && <Label isCompact>{_("Hidden")}</Label>}
    </Flex>
);

export const SensorTable = ({ chipName, chipData, category }: {
    chipName: string;
    chipData: SensorChipGroup;
    category: SensorCategory;
}) => {
    const view = useSensorView();
    const { onEnableHistory } = view;
    const rows = Object.entries(extractSensorGroup(chipData, category.key)).filter(([label]) => {
        const key = sensorKey(chipName, label);
        return isVisible(view, key) && matchesFilter(view, label, view.aliases[key]);
    });
    if (!rows.length) {
        return null;
    }

    // columns: the sub-features ("input", "max", ...) present in any row, in order of appearance;
    // alarm and fault flags are summarized in the status column instead
    const columns: string[] = [];
    for (const [, values] of rows) {
        for (const key of Object.keys(values)) {
            const stripped = formatSensorKey(key);
            if (!isFlagKey(stripped) && !columns.includes(stripped))
                columns.push(stripped);
        }
    }

    const convert = (value: number) => toDisplayValue(category.key, value, view.fahrenheit);
    const format = (value: number) => formatDisplayValue(category.key, value, view.fahrenheit);

    return (
        <Card className="sensors-card">
            <CardHeader>
                <CardTitle>
                    <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }}>
                        <category.icon />
                        <span>{category.label}</span>
                    </Flex>
                </CardTitle>
            </CardHeader>
            <CardBody>
                <Table variant="compact" aria-label={category.label}>
                    <Thead>
                        <Tr>
                            <Th screenReaderText={_("Show history")} />
                            <Th>{_("Label")}</Th>
                            <Th>{_("Status")}</Th>
                            {columns.map((column) => (
                                <Th key={column} modifier="wrap">{subFeatureLabel(column)}</Th>
                            ))}
                            {category.key !== "intrusion" && <Th>{_("Recent")}</Th>}
                            <Th screenReaderText={_("Actions")} />
                        </Tr>
                    </Thead>
                    {rows.map(([label, values], rowIndex) => {
                        const key = sensorKey(chipName, label);
                        const alias = view.aliases[key];
                        const hidden = view.hidden.has(key);
                        const metric = pcpMetricName(chipName, label);
                        const withHistory = hasHistory(values);
                        const isExpanded = withHistory && view.expanded.has(metric);
                        const max = getSubFeature(values, "max");
                        const crit = getSubFeature(values, "crit");
                        const status = view.statuses.get(chipName, label, category.key, values);
                        const muted = view.muted.has(key);
                        const trend = view.trends.get(key);

                        return (
                            <Tbody key={label} isExpanded={isExpanded}>
                                <Tr className={hidden ? "sensors-row-hidden" : ""}>
                                    {withHistory
                                        ? <Td expand={{ rowIndex, isExpanded, onToggle: () => view.onToggleExpanded(metric), expandId: `history-${metric}` }} />
                                        : <Td />}
                                    <Td dataLabel={_("Label")}>
                                        <SensorName name={label} alias={alias} hidden={hidden} />
                                    </Td>
                                    <Td dataLabel={_("Status")}>
                                        <StatusLabel status={status} categoryKey={category.key} fahrenheit={view.fahrenheit} muted={muted} />
                                    </Td>
                                    {columns.map((column) => {
                                        const value = getSubFeature(values, column);
                                        const highlight = (column === "input" || column === "average") && status.level !== "ok" && !muted;
                                        return (
                                            <Td
                                                key={column}
                                                dataLabel={subFeatureLabel(column)}
                                                className={highlight ? `sensors-value-${status.level}` : ""}
                                            >
                                                {typeof value === "number"
                                                    ? formatSensorValue(category.key, column, value, view.fahrenheit)
                                                    : "—"}
                                            </Td>
                                        );
                                    })}
                                    {category.key !== "intrusion" &&
                                        <Td dataLabel={_("Recent")}>
                                            {trend && <Sparkline trend={trend} convert={convert} format={format} />}
                                        </Td>}
                                    <Td isActionCell>
                                        <ActionsColumn
                                            items={[
                                                {
                                                    title: _("Rename"),
                                                    onClick: () => view.onRename(key, label),
                                                },
                                                {
                                                    title: muted ? _("Watch alerts") : _("Ignore alerts"),
                                                    onClick: () => view.onSetMuted(key, !muted),
                                                },
                                                {
                                                    title: hidden ? _("Show") : _("Hide"),
                                                    onClick: () => view.onSetHidden(key, !hidden),
                                                },
                                            ]}
                                        />
                                    </Td>
                                </Tr>
                                {isExpanded &&
                                    <Tr isExpanded>
                                        <Td colSpan={columns.length + 5}>
                                            <ExpandableRowContent>
                                                <HistoryPanel
                                                    metric={metric}
                                                    name={alias || label}
                                                    categoryKey={category.key}
                                                    fahrenheit={view.fahrenheit}
                                                    max={max}
                                                    crit={crit}
                                                    status={view.historyStatus}
                                                    onEnable={onEnableHistory}
                                                />
                                            </ExpandableRowContent>
                                        </Td>
                                    </Tr>}
                            </Tbody>
                        );
                    })}
                </Table>
            </CardBody>
        </Card>
    );
};
