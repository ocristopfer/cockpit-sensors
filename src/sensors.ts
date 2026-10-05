/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import type { SVGIconProps } from "@patternfly/react-icons/dist/esm/createIcon";

import { BatteryFullIcon } from "@patternfly/react-icons/dist/esm/icons/battery-full-icon.js";
import { BoltIcon } from "@patternfly/react-icons/dist/esm/icons/bolt-icon.js";
import { ChargingStationIcon } from "@patternfly/react-icons/dist/esm/icons/charging-station-icon.js";
import { FanIcon } from "@patternfly/react-icons/dist/esm/icons/fan-icon.js";
import { PlugIcon } from "@patternfly/react-icons/dist/esm/icons/plug-icon.js";
import { ShieldAltIcon } from "@patternfly/react-icons/dist/esm/icons/shield-alt-icon.js";
import { ThermometerHalfIcon } from "@patternfly/react-icons/dist/esm/icons/thermometer-half-icon.js";
import { TintIcon } from "@patternfly/react-icons/dist/esm/icons/tint-icon.js";
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

// the sensor types of libsensors, named after their sub-feature prefix ("temp1_input", "power1_average", ...)
export const sensorCategories: SensorCategory[] = [
    { key: "temp", label: _("Temperatures"), icon: ThermometerHalfIcon },
    { key: "fan", label: _("Fans"), icon: FanIcon },
    { key: "in", label: _("Voltages"), icon: ChargingStationIcon },
    { key: "power", label: _("Power"), icon: BoltIcon },
    { key: "curr", label: _("Currents"), icon: PlugIcon },
    { key: "energy", label: _("Energy"), icon: BatteryFullIcon },
    { key: "humidity", label: _("Humidity"), icon: TintIcon },
    { key: "intrusion", label: _("Chassis intrusion"), icon: ShieldAltIcon },
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

// the unit of a category's values, as displayed
export const unitLabel = (categoryKey: string, fahrenheit: boolean): string => {
    switch (categoryKey) {
    case "temp": return fahrenheit ? "°F" : "°C";
    case "fan": return "RPM";
    case "in": return "V";
    case "power": return "W";
    case "curr": return "A";
    case "energy": return "J";
    case "humidity": return "%";
    default: return "";
    }
};

// format a value that is already in display units
export const formatDisplayValue = (categoryKey: string, value: number, fahrenheit: boolean): string => {
    switch (categoryKey) {
    case "temp":
        return `${value.toFixed(1)} ${fahrenheit ? "°F" : "°C"}`;
    case "fan":
        return cockpit.format(_("$0 RPM"), value.toFixed(0));
    case "in":
        return `${value.toFixed(2)} V`;
    case "power":
        return `${value.toFixed(2)} W`;
    case "curr":
        return `${value.toFixed(2)} A`;
    case "energy":
        return `${value.toFixed(1)} J`;
    case "humidity":
        return `${value.toFixed(1)} %`;
    default:
        return String(value);
    }
};

export const formatSensorValue = (categoryKey: string, key: string, value: number, fahrenheit: boolean): string => {
    // flags and counts (e.g. fan1_pulses)
    if (isFlagKey(key) || key === "pulses" || key === "div") {
        return String(value);
    }
    // e.g. power1_average_interval, in seconds
    if (key.endsWith("interval")) {
        return cockpit.format(_("$0 s"), value);
    }
    // a temperature difference, not an absolute temperature
    if (categoryKey === "temp" && key === "offset") {
        return `${(fahrenheit ? value * 9 / 5 : value).toFixed(1)} ${fahrenheit ? "°F" : "°C"}`;
    }
    return formatDisplayValue(categoryKey, toDisplayValue(categoryKey, value, fahrenheit), fahrenheit);
};

// column header of a sub-feature ("max_hyst" -> "Max hysteresis")
export const subFeatureLabel = (key: string): string => {
    switch (key) {
    case "input": return _("Value");
    case "average": return _("Average");
    case "min": return _("Min");
    case "max": return _("Max");
    case "lcrit": return _("Low critical");
    case "crit": return _("Critical");
    case "emergency": return _("Emergency");
    case "max_hyst": return _("Max hysteresis");
    case "min_hyst": return _("Min hysteresis");
    case "crit_hyst": return _("Critical hysteresis");
    case "lcrit_hyst": return _("Low critical hysteresis");
    case "emergency_hyst": return _("Emergency hysteresis");
    case "lowest": return _("Lowest");
    case "highest": return _("Highest");
    case "offset": return _("Offset");
    case "target": return _("Target");
    case "pulses": return _("Pulses");
    case "cap": return _("Cap");
    case "average_interval": return _("Averaging interval");
    default: return key;
    }
};

// the current reading of a sensor: "input", or "average" for power meters without one
export const getReading = (values: SensorValueGroup): number | undefined =>
    getSubFeature(values, "input") ?? getSubFeature(values, "average");

export type SensorStatusLevel = "ok" | "warning" | "critical";

export type StatusReasonKind =
    | "emergency" | "crit" | "max" | "lcrit" | "min" | "stopped" // reading beyond a limit
    | "crit_alarm" | "alarm" | "fault" | "intrusion"; // flags set by the chip

// why a sensor is not ok; limit is the exceeded limit, in the sensor's raw unit
export type StatusReason = { kind: StatusReasonKind; limit?: number };

export type SensorStatus = { level: SensorStatusLevel; reasons: StatusReason[] };

const levelOrder: Record<SensorStatusLevel, number> = { ok: 0, warning: 1, critical: 2 };

export const worstLevel = (levels: SensorStatusLevel[]): SensorStatusLevel =>
    levels.reduce<SensorStatusLevel>((worst, level) => levelOrder[level] > levelOrder[worst] ? level : worst, "ok");

// limits of 0 mean "not set" for most chips
const isLimit = (value: number | undefined): value is number => typeof value === "number" && value !== 0;

/*
 * Whether a sensor is fine, judged by the alarm and fault flags that the chip
 * reports and by comparing its reading with its limits.
 *
 * Only critical limits (crit, lcrit, emergency, a stopped fan) make a sensor
 * critical. Plain alarm flags mean "outside min/max" for most chips, and are
 * often set for unconnected inputs, so they only raise a warning.
 *
 * With the previous status of the sensor, a sensor that went above max or
 * crit stays there until its reading drops below the chip's hysteresis
 * (max_hyst, crit_hyst), so that it does not flap around the limit.
 */
export const sensorStatus = (categoryKey: string, values: SensorValueGroup, previous?: SensorStatus): SensorStatus => {
    const reasons: StatusReason[] = [];
    let level: SensorStatusLevel = "ok";
    const raise = (newLevel: SensorStatusLevel, kind: StatusReasonKind, limit?: number) => {
        if (!reasons.some(r => r.kind === kind))
            reasons.push(limit === undefined ? { kind } : { kind, limit });
        level = worstLevel([level, newLevel]);
    };

    const reading = getReading(values);
    if (typeof reading === "number") {
        const min = getSubFeature(values, "min");
        const max = getSubFeature(values, "max");
        const crit = getSubFeature(values, "crit");
        const lcrit = getSubFeature(values, "lcrit");
        const emergency = getSubFeature(values, "emergency");
        // some chips report min > max for unused inputs, and USB-C sources min == max (the negotiated
        // voltage); such limits are no range to check against
        const limitsValid = !(isLimit(min) && isLimit(max) && min >= max);

        // whether the reading is above a limit, or still above its hysteresis after having been above it
        const above = (kind: StatusReasonKind, limit: number, hystKey: string): boolean => {
            if (reading > limit || (kind !== "max" && reading >= limit))
                return true;
            const hyst = getSubFeature(values, hystKey);
            return !!previous?.reasons.some(r => r.kind === kind) && isLimit(hyst) && hyst < limit && reading > hyst;
        };

        if (isLimit(emergency) && above("emergency", emergency, "emergency_hyst"))
            raise("critical", "emergency", emergency);
        else if (isLimit(crit) && above("crit", crit, "crit_hyst"))
            raise("critical", "crit", crit);
        else if (limitsValid && isLimit(max) && above("max", max, "max_hyst"))
            raise("warning", "max", max);

        if (categoryKey === "fan") {
            if (isLimit(min) && reading === 0)
                raise("critical", "stopped");
            else if (isLimit(min) && reading < min)
                raise("warning", "min", min);
        } else if (isLimit(lcrit) && reading <= lcrit) {
            raise("critical", "lcrit", lcrit);
        } else if (limitsValid && isLimit(min) && reading < min) {
            raise("warning", "min", min);
        }
    }

    for (const [key, value] of Object.entries(values)) {
        const stripped = formatSensorKey(key);
        if (value !== 1)
            continue;
        // alarms already explained by a limit (e.g. "Above the maximum (80.0 °C)") add nothing
        if (categoryKey === "intrusion" && stripped.endsWith("alarm")) {
            raise("warning", "intrusion");
        } else if (/^(crit|lcrit|emergency)_alarm$/.test(stripped)) {
            if (!reasons.some(r => r.kind === "emergency" || r.kind === "crit" || r.kind === "lcrit"))
                raise("critical", "crit_alarm");
        } else if (stripped.endsWith("alarm")) {
            if (reasons.length === 0)
                raise("warning", "alarm");
        } else if (stripped.endsWith("fault")) {
            raise("warning", "fault");
        }
    }

    return { level, reasons };
};

// a reason as text, e.g. "Above the maximum (80.0 °C)"
export const formatReason = (categoryKey: string, reason: StatusReason, fahrenheit: boolean): string => {
    const limit = reason.limit === undefined ? "" : formatSensorValue(categoryKey, "input", reason.limit, fahrenheit);
    switch (reason.kind) {
    case "emergency": return cockpit.format(_("Above the emergency limit ($0)"), limit);
    case "crit": return cockpit.format(_("Above the critical limit ($0)"), limit);
    case "max": return cockpit.format(_("Above the maximum ($0)"), limit);
    case "lcrit": return cockpit.format(_("Below the critical limit ($0)"), limit);
    case "min": return cockpit.format(_("Below the minimum ($0)"), limit);
    case "stopped": return _("Fan stopped");
    case "crit_alarm": return _("Critical alarm reported by the chip");
    case "alarm": return _("Alarm reported by the chip");
    case "fault": return _("Sensor fault");
    case "intrusion": return _("Chassis was opened");
    }
};

export const formatReasons = (categoryKey: string, status: SensorStatus, fahrenheit: boolean): string =>
    status.reasons.map(r => formatReason(categoryKey, r, fahrenheit)).join(", ");

/*
 * A readable name for a chip, from the name of its kernel driver
 * ("coretemp-isa-0000" -> "CPU (Intel)"); the chip name itself when unknown.
 */
const chipDrivers: [RegExp, () => string][] = [
    [/^coretemp$/, () => _("CPU (Intel)")],
    [/^(k8temp|k10temp|zenpower|fam15h_power)$/, () => _("CPU (AMD)")],
    [/^(cpu_thermal|cpu-thermal|soc_thermal)$/, () => _("CPU")],
    [/^(amdgpu|radeon|nouveau|i915|xe)$/, () => _("GPU")],
    [/^nvme$/, () => _("NVMe drive")],
    [/^drivetemp$/, () => _("Disk")],
    [/^(acpitz|thermal_zone\d*)$/, () => _("ACPI thermal zone")],
    [/^(nct\d+\w*|it\d+\w*|w83\w+|f71\w+|asus\w*|asus_ec|sch\d+\w*|dme1737)$/, () => _("Motherboard")],
    [/^(pch_\w+)$/, () => _("Chipset")],
    [/^(jc42|spd5118|ee1004)$/, () => _("Memory")],
    [/^(iwlwifi\w*|mt79\w+|ath\d+k\w*|rtw\w+)$/, () => _("Wi-Fi")],
    [/^(r8169\w*|mlx\w+|ixgbe|igb|igc|e1000e|bnxt\w*|tg3|atlantic)$/, () => _("Network")],
    [/^(BAT\d+|battery\w*)$/, () => _("Battery")],
    [/^(AC\d*|ADP\d*|ucsi_\S*)$/, () => _("Power supply")],
    [/^(dell_smm|dell_ddv)$/, () => _("Dell embedded controller")],
    [/^thinkpad$/, () => _("ThinkPad embedded controller")],
    [/^applesmc$/, () => _("Apple SMC")],
    [/^(corsair\w*|nzxt\w*)$/, () => _("Cooling controller")],
    [/^(rpi_volt|raspberrypi\w*)$/, () => _("Raspberry Pi")],
];

export const chipDisplayName = (chipName: string): string => {
    const driver = chipName.split("-")[0];
    return chipDrivers.find(([regex]) => regex.test(driver))?.[1]() ?? chipName;
};

// display names for all chips, numbered when several chips share one ("NVMe drive 1", "NVMe drive 2")
export const chipDisplayNames = (chipNames: string[]): Record<string, string> => {
    const names = chipNames.map(chipDisplayName);
    const result: Record<string, string> = {};
    const seen: Record<string, number> = {};
    chipNames.forEach((chipName, i) => {
        const name = names[i];
        if (names.filter(n => n === name).length > 1) {
            seen[name] = (seen[name] ?? 0) + 1;
            result[chipName] = `${name} ${seen[name]}`;
        } else {
            result[chipName] = name;
        }
    });
    return result;
};
