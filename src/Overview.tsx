/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Gallery } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";
import { CheckCircleIcon } from "@patternfly/react-icons/dist/esm/icons/check-circle-icon.js";
import { SearchIcon } from "@patternfly/react-icons/dist/esm/icons/search-icon.js";
import cockpit from "cockpit";
import React from "react";

import { extractSensorGroup, formatDisplayValue, formatReasons, getReading, sensorCategories, toDisplayValue, worstLevel } from "./sensors";
import type { SensorCategory, SensorChipGroup, SensorData, SensorStatus } from "./sensors";
import { StatusIcon } from "./StatusIcon";
import { sensorKey } from "./trend";
import { isVisible, matchesFilter, useSensorView } from "./view";
import type { SensorView } from "./view";

const _ = cockpit.gettext;

type SensorEntry = {
    name: string;
    category: SensorCategory;
    reading: number | undefined;
    status: SensorStatus;
    // whether the sensor's alerts count, i.e. they are not ignored
    alerting: boolean;
};

// the visible sensors of a chip that match the filter
const chipSensors = (view: SensorView, chipName: string, chip: SensorChipGroup): SensorEntry[] =>
    sensorCategories.flatMap(category =>
        Object.entries(extractSensorGroup(chip, category.key))
                .filter(([label]) => {
                    const key = sensorKey(chipName, label);
                    return isVisible(view, key) && matchesFilter(view, label, view.aliases[key]);
                })
                .map(([label, values]) => {
                    const key = sensorKey(chipName, label);
                    return {
                        name: view.aliases[key] || label,
                        category,
                        reading: getReading(values),
                        status: view.statuses.get(chipName, label, category.key, values),
                        alerting: !view.muted.has(key),
                    };
                }));

// one line describing all sensors of a category of a chip
const categorySummary = (view: SensorView, category: SensorCategory, sensors: SensorEntry[]): string => {
    const format = (value: number) => formatDisplayValue(category.key, toDisplayValue(category.key, value, view.fahrenheit), view.fahrenheit);
    const withReading = sensors.filter((s): s is SensorEntry & { reading: number } => typeof s.reading === "number");

    if (category.key === "intrusion")
        return sensors.some(s => s.status.reasons.some(r => r.kind === "intrusion")) ? _("Opened") : _("Closed");
    if (withReading.length === 0)
        return cockpit.format(cockpit.ngettext("$0 sensor", "$0 sensors", sensors.length), sensors.length);
    if (withReading.length === 1)
        return `${withReading[0].name}: ${format(withReading[0].reading)}`;

    if (category.key === "temp") {
        const hottest = withReading.reduce((a, b) => b.reading > a.reading ? b : a);
        return cockpit.format(_("Highest: $0 ($1)"), format(hottest.reading), hottest.name);
    }
    if (category.key === "fan") {
        const running = withReading.filter(s => s.reading > 0).map(s => s.reading);
        if (running.length === 0)
            return _("All stopped");
        const range = running.length === 1
            ? format(running[0])
            : `${format(Math.min(...running))} – ${format(Math.max(...running))}`;
        return cockpit.format(cockpit.ngettext("$0 running: $1", "$0 running: $1", running.length), running.length, range);
    }
    if (category.key === "power" || category.key === "energy")
        return cockpit.format(_("Total: $0"), format(withReading.reduce((sum, s) => sum + s.reading, 0)));

    const readings = withReading.map(s => s.reading);
    return `${format(Math.min(...readings))} – ${format(Math.max(...readings))}`;
};

const ChipCard = ({ chipName, displayName, sensors, onSelect }: {
    chipName: string;
    displayName: string;
    sensors: SensorEntry[];
    onSelect: () => void;
}) => {
    const view = useSensorView();
    const problems = sensors.filter(s => s.alerting && s.status.level !== "ok");
    const level = worstLevel(problems.map(s => s.status.level));
    const titleId = `overview-${chipName}`;

    return (
        <Card isClickable isCompact className="sensors-overview-card">
            <CardHeader
                selectableActions={{
                    onClickAction: onSelect,
                    selectableActionId: `${titleId}-select`,
                    selectableActionAriaLabelledby: titleId,
                }}
            >
                <CardTitle id={titleId}>
                    <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }}>
                        <span>{displayName}</span>
                        <StatusIcon level={level} />
                    </Flex>
                </CardTitle>
                <div className="sensors-original-name">{chipName}</div>
            </CardHeader>
            <CardBody>
                <DescriptionList isCompact isHorizontal horizontalTermWidthModifier={{ default: "18ch" }}>
                    {sensorCategories.map(category => {
                        const inCategory = sensors.filter(s => s.category.key === category.key);
                        if (!inCategory.length)
                            return null;
                        return (
                            <DescriptionListGroup key={category.key}>
                                <DescriptionListTerm icon={<category.icon />}>{category.label}</DescriptionListTerm>
                                <DescriptionListDescription>{categorySummary(view, category, inCategory)}</DescriptionListDescription>
                            </DescriptionListGroup>
                        );
                    })}
                </DescriptionList>
                {problems.length > 0 &&
                    <ul className="sensors-overview-problems">
                        {problems.map(s => (
                            <li key={`${s.category.key}-${s.name}`}>
                                <StatusIcon level={s.status.level} />
                                {" "}
                                {`${s.name}: ${formatReasons(s.category.key, s.status, view.fahrenheit)}`}
                            </li>
                        ))}
                    </ul>}
            </CardBody>
        </Card>
    );
};

export const Overview = ({ sensorData, chipNames, onSelect }: {
    sensorData: SensorData;
    chipNames: Record<string, string>;
    onSelect: (chipName: string) => void;
}) => {
    const view = useSensorView();
    const chips = Object.entries(sensorData)
            .filter(([chipName]) => isVisible(view, chipName))
            .map(([chipName, chip]) => ({ chipName, sensors: chipSensors(view, chipName, chip) }))
            .filter(({ sensors }) => sensors.length > 0);

    if (chips.length === 0) {
        return (
            <EmptyState headingLevel="h2" icon={SearchIcon} titleText={_("No matching sensors")} variant="sm">
                <EmptyStateBody>{_("No sensor matches the filter.")}</EmptyStateBody>
            </EmptyState>
        );
    }

    const all = chips.flatMap(c => c.sensors);
    const critical = all.filter(s => s.alerting && s.status.level === "critical").length;
    const warning = all.filter(s => s.alerting && s.status.level === "warning").length;

    return (
        <>
            <Flex className="sensors-overview-summary" spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }}>
                {critical + warning === 0
                    ? (
                        <>
                            <CheckCircleIcon className="sensors-status-icon-ok" />
                            <span>
                                {cockpit.format(cockpit.ngettext("$0 sensor, all normal", "$0 sensors, all normal", all.length), all.length)}
                            </span>
                        </>
                    )
                    : (
                        <>
                            <StatusIcon level={critical ? "critical" : "warning"} />
                            <span>
                                {[
                                    critical && cockpit.format(cockpit.ngettext("$0 critical", "$0 critical", critical), critical),
                                    warning && cockpit.format(cockpit.ngettext("$0 warning", "$0 warnings", warning), warning),
                                ].filter(Boolean).join(", ")}
                            </span>
                        </>
                    )}
            </Flex>
            <Gallery hasGutter minWidths={{ default: "300px" }}>
                {chips.map(({ chipName, sensors }) => (
                    <ChipCard
                        key={chipName}
                        chipName={chipName}
                        displayName={view.aliases[chipName] || chipNames[chipName]}
                        sensors={sensors}
                        onSelect={() => onSelect(chipName)}
                    />
                ))}
            </Gallery>
        </>
    );
};
