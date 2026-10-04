/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import type { SVGIconProps } from "@patternfly/react-icons/dist/esm/createIcon";

import { ChargingStationIcon } from "@patternfly/react-icons/dist/esm/icons/charging-station-icon.js";
import { FanIcon } from "@patternfly/react-icons/dist/esm/icons/fan-icon.js";
import { ThermometerHalfIcon } from "@patternfly/react-icons/dist/esm/icons/thermometer-half-icon.js";
import cockpit from "cockpit";
import type React from "react";

const _ = cockpit.gettext;

export type SensorValueGroup = Record<string, number>;
export type SensorChipGroup = {
    Adapter?: string;
    [key: string]: SensorValueGroup | string | undefined; // Label
};
export type SensorData = Record<string, SensorChipGroup>;
export type SensorCategory = {
    key: string;
    label: string;
    icon: React.ComponentClass<SVGIconProps>;
};

export const sensorCategories: SensorCategory[] = [
    {
        key: "fan",
        label: _("Fans"),
        icon: FanIcon,
    },
    {
        key: "in",
        label: _("Voltages"),
        icon: ChargingStationIcon,
    },
    {
        key: "temp",
        label: _("Temperatures"),
        icon: ThermometerHalfIcon,
    },
];

// Sub-features that are flags/enums rather than measurements (e.g. temp1_crit_alarm, temp1_type)
export const isFlagKey = (key: string): boolean => /(alarm|beep|fault|type)$/.test(key);

// Parse the output of `sensors -u`, for lm-sensors versions without JSON support (-j)
export const parseSensorsRaw = (output: string): SensorData => {
    const data: SensorData = {};
    let chip: SensorChipGroup | null = null;
    let label: string | null = null;

    for (const line of output.split("\n")) {
        if (!line.trim()) {
            chip = null;
            continue;
        }
        if (chip === null) {
            chip = {};
            data[line.trim()] = chip;
            label = null;
            continue;
        }
        if (line.startsWith("Adapter:")) {
            chip.Adapter = line.slice("Adapter:".length).trim();
            continue;
        }
        if (!/^\s/.test(line) && line.trimEnd().endsWith(":")) {
            label = line.trimEnd().slice(0, -1);
            chip[label] = {};
            continue;
        }
        const match = /^\s+(\S+):\s+(\S+)/.exec(line);
        if (match && label !== null) {
            const value = parseFloat(match[2]);
            if (!isNaN(value))
                (chip[label] as SensorValueGroup)[match[1]] = value;
        }
    }

    return data;
};

export const getOsIds = (osRelease: string): string[] => {
    const field = (name: string) => new RegExp(`^${name}=(.+)$`, "m").exec(osRelease)?.[1].replace(/"/g, "") ?? "";
    return [field("ID"), ...field("ID_LIKE").split(" ")].filter(Boolean);
};

export const readOsIds = async (): Promise<string[]> => getOsIds(await cockpit.file("/etc/os-release").read() ?? "");

// rows of one category (e.g. all "temp*" sub-features) of a chip, keyed by sensor label
export const extractSensorGroup = (chip: SensorChipGroup, prefix: string): Record<string, SensorValueGroup> => {
    const rows: Record<string, SensorValueGroup> = {};
    const regex = new RegExp(`^${prefix}\\d+_`);

    for (const [label, values] of Object.entries(chip)) {
        if (label === "Adapter" || typeof values !== "object") {
            continue;
        }

        const entries = Object.entries(values).filter(([k]) => regex.test(k));

        if (entries.length > 0) {
            rows[label] = Object.fromEntries(entries);
        }
    }

    return rows;
};

// "temp1_crit_alarm" -> "crit_alarm"
export const formatSensorKey = (key: string): string => {
    const idx = key.indexOf("_");
    return idx !== -1 ? key.slice(idx + 1) : key;
};

// the sub-feature value of a sensor row by its stripped key ("input", "max", ...)
export const getSubFeature = (values: SensorValueGroup, strippedKey: string): number | undefined =>
    Object.entries(values).find(([key]) => formatSensorKey(key) === strippedKey)?.[1];

export const celsiusToFahrenheit = (value: number): number => (value * 9) / 5 + 32;

// convert a measurement to the unit it is displayed in
export const toDisplayValue = (categoryKey: string, value: number, fahrenheit: boolean): number =>
    categoryKey === "temp" && fahrenheit ? celsiusToFahrenheit(value) : value;

// format a value that is already in display units
export const formatDisplayValue = (categoryKey: string, value: number, fahrenheit: boolean): string => {
    if (categoryKey === "temp") {
        return `${value.toFixed(1)} ${fahrenheit ? "°F" : "°C"}`;
    }
    if (categoryKey === "fan") {
        return cockpit.format(_("$0 RPM"), value.toFixed(0));
    }
    return `${value.toFixed(2)} V`;
};

export const formatSensorValue = (categoryKey: string, key: string, value: number, fahrenheit: boolean): string => {
    if (isFlagKey(key)) {
        return String(value);
    }
    if (categoryKey === "temp") {
        return formatDisplayValue(categoryKey, toDisplayValue(categoryKey, value, fahrenheit), fahrenheit);
    }
    return categoryKey === "fan" ? value.toFixed(0) : value.toFixed(2);
};
