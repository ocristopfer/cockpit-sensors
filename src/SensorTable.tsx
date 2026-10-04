/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { ExpandableRowContent, Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table/dist/esm/components/Table/index.js";
import cockpit from "cockpit";
import React from "react";

import { HistoryPanel } from "./HistoryChart";
import { hasHistory, pcpMetricName } from "./history";
import type { HistoryStatus } from "./history";
import { extractSensorGroup, formatSensorKey, formatSensorValue, getSubFeature, isFlagKey, sensorStatus, subFeatureLabel } from "./sensors";
import type { SensorCategory, SensorChipGroup, SensorStatus } from "./sensors";

const _ = cockpit.gettext;

export const StatusLabel = ({ status }: { status: SensorStatus }) => {
    if (status.level === "ok")
        return <Label isCompact variant="outline" status="success">{_("Normal")}</Label>;

    const label = (
        <Label isCompact status={status.level === "critical" ? "danger" : "warning"}>
            {status.level === "critical" ? _("Critical") : _("Warning")}
        </Label>
    );
    return <Tooltip content={status.reasons.join(", ")}>{label}</Tooltip>;
};

export const SensorTable = ({ chipName, chipData, category, fahrenheit, expanded, onToggle, historyStatus, onEnableHistory }: {
    chipName: string;
    chipData: SensorChipGroup;
    category: SensorCategory;
    fahrenheit: boolean;
    expanded: Set<string>;
    onToggle: (metric: string) => void;
    historyStatus: HistoryStatus;
    onEnableHistory: () => void;
}) => {
    const rows = extractSensorGroup(chipData, category.key);
    if (!Object.keys(rows).length) {
        return null;
    }

    // columns: the sub-features ("input", "max", ...) present in any row, in order of appearance;
    // alarm and fault flags are summarized in the status column instead
    const columns: string[] = [];
    for (const values of Object.values(rows)) {
        for (const key of Object.keys(values)) {
            const stripped = formatSensorKey(key);
            if (!isFlagKey(stripped) && !columns.includes(stripped))
                columns.push(stripped);
        }
    }

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
                                <Th key={column}>{subFeatureLabel(column)}</Th>
                            ))}
                        </Tr>
                    </Thead>
                    {Object.entries(rows).map(([label, values], rowIndex) => {
                        const metric = pcpMetricName(chipName, label);
                        const withHistory = hasHistory(values);
                        const isExpanded = withHistory && expanded.has(metric);
                        const max = getSubFeature(values, "max");
                        const crit = getSubFeature(values, "crit");
                        const status = sensorStatus(category.key, values);

                        return (
                            <Tbody key={label} isExpanded={isExpanded}>
                                <Tr>
                                    {withHistory
                                        ? <Td expand={{ rowIndex, isExpanded, onToggle: () => onToggle(metric), expandId: `history-${metric}` }} />
                                        : <Td />}
                                    <Td dataLabel={_("Label")}>{label}</Td>
                                    <Td dataLabel={_("Status")}><StatusLabel status={status} /></Td>
                                    {columns.map((column) => {
                                        const value = getSubFeature(values, column);
                                        const highlight = (column === "input" || column === "average") && status.level !== "ok";
                                        return (
                                            <Td
                                                key={column}
                                                dataLabel={subFeatureLabel(column)}
                                                className={highlight ? `sensors-value-${status.level}` : ""}
                                            >
                                                {typeof value === "number"
                                                    ? formatSensorValue(category.key, column, value, fahrenheit)
                                                    : "—"}
                                            </Td>
                                        );
                                    })}
                                </Tr>
                                {isExpanded &&
                                    <Tr isExpanded>
                                        <Td colSpan={columns.length + 3}>
                                            <ExpandableRowContent>
                                                <HistoryPanel
                                                    metric={metric}
                                                    categoryKey={category.key}
                                                    fahrenheit={fahrenheit}
                                                    max={max}
                                                    crit={crit}
                                                    status={historyStatus}
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
