/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { ExpandableRowContent, Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table/dist/esm/components/Table/index.js";
import cockpit from "cockpit";
import React from "react";

import { HistoryPanel } from "./HistoryChart";
import { hasHistory, pcpMetricName } from "./history";
import type { HistoryStatus } from "./history";
import { extractSensorGroup, formatSensorKey, formatSensorValue, getSubFeature } from "./sensors";
import type { SensorCategory, SensorChipGroup } from "./sensors";

const _ = cockpit.gettext;

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

    // columns: the sub-features ("input", "max", ...) present in any row, in order of appearance
    const columns: string[] = [];
    for (const values of Object.values(rows)) {
        for (const key of Object.keys(values)) {
            const stripped = formatSensorKey(key);
            if (!columns.includes(stripped))
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
                            {columns.map((column) => (
                                <Th key={column}>{column}</Th>
                            ))}
                        </Tr>
                    </Thead>
                    {Object.entries(rows).map(([label, values], rowIndex) => {
                        const metric = pcpMetricName(chipName, label);
                        const withHistory = hasHistory(values);
                        const isExpanded = withHistory && expanded.has(metric);
                        const max = getSubFeature(values, "max");
                        const crit = getSubFeature(values, "crit");

                        return (
                            <Tbody key={label} isExpanded={isExpanded}>
                                <Tr>
                                    {withHistory
                                        ? <Td expand={{ rowIndex, isExpanded, onToggle: () => onToggle(metric), expandId: `history-${metric}` }} />
                                        : <Td />}
                                    <Td dataLabel={_("Label")}>{label}</Td>
                                    {columns.map((column) => {
                                        const value = getSubFeature(values, column);
                                        const critical = column === "input" && typeof value === "number" &&
                                            typeof max === "number" && max !== 0 && value > max;
                                        return (
                                            <Td
                                                key={column}
                                                dataLabel={column}
                                                className={critical ? "sensors-value-critical" : ""}
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
                                        <Td colSpan={columns.length + 2}>
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
