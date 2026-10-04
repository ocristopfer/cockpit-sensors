/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2017 Red Hat, Inc.
 */

import type { SVGIconProps } from "@patternfly/react-icons/dist/esm/createIcon";

import { Alert, AlertActionCloseButton } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Tab, Tabs, TabTitleText } from "@patternfly/react-core/dist/esm/components/Tabs/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { ChargingStationIcon } from "@patternfly/react-icons/dist/esm/icons/charging-station-icon.js";
import { FanIcon } from "@patternfly/react-icons/dist/esm/icons/fan-icon.js";
import { ThermometerHalfIcon } from "@patternfly/react-icons/dist/esm/icons/thermometer-half-icon.js";
import { Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table/dist/esm/components/Table/index.js";
import cockpit from "cockpit";
import React, { useCallback, useEffect, useState } from "react";

const _ = cockpit.gettext;

// Global Types
type AlertInfo = {
    msg: string;
    variant: "danger" | "warning" | "info" | "success";
} | null;

type SensorValueGroup = Record<string, number>;
type SensorChipGroup = {
    Adapter?: string;
    [key: string]: SensorValueGroup | string | undefined; // Label
};
type SensorData = Record<string, SensorChipGroup>;
type SensorCategory = {
    key: string;
    label: string;
    icon: React.ComponentClass<SVGIconProps>;
};

// Global constants
const sensorCategories: SensorCategory[] = [
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
const isFlagKey = (key: string): boolean => /(alarm|beep|fault|type)$/.test(key);

// Parse the output of `sensors -u`, for lm-sensors versions without JSON support (-j)
const parseSensorsRaw = (output: string): SensorData => {
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

const getOsIds = (osRelease: string): string[] => {
    const field = (name: string) => new RegExp(`^${name}=(.+)$`, "m").exec(osRelease)?.[1].replace(/"/g, "") ?? "";
    return [field("ID"), ...field("ID_LIKE").split(" ")].filter(Boolean);
};

const Application = () => {
    // ---------------------------------------- //
    // Hooks
    // ---------------------------------------- //
    const [installed, setInstalled] = useState<boolean>(true);
    const [loading, setLoading] = useState<boolean>(false);
    const [alert, setAlert] = useState<AlertInfo>(null);

    const [activeTabKey, setActiveTabKey] = useState<string | number>(0);
    const [sensorData, setSensorData] = useState<SensorData>({});
    const [jsonSupported, setJsonSupported] = useState<boolean>(true);
    const [fahrenheitChecked, setFahrenheitChecked] = useState<boolean>(
        () => localStorage.getItem("fahrenheitChecked") === "true"
    );

    // ---------------------------------------- //
    // Callbacks
    // ---------------------------------------- //
    const loadSensors = useCallback(() => {
        if (loading || !installed) {
            return;
        }
        cockpit
                .spawn(["sensors", jsonSupported ? "-j" : "-u"], { err: "message", superuser: "try" })
                .done((output: string) => {
                    if (!jsonSupported) {
                        setSensorData(parseSensorsRaw(output));
                        return;
                    }
                    try {
                        setSensorData(JSON.parse(output));
                    } catch {
                        // some lm-sensors versions emit invalid JSON for unreadable sub-features
                        setJsonSupported(false);
                    }
                })
                .fail((err: { message: string, problem?: string }) => {
                    if (err.problem === "not-found" || err.message === "not-found") {
                        setInstalled(false);
                        setAlert({
                            msg: _("lm-sensors not found, do you want to install it?"),
                            variant: "danger",
                        });
                        return;
                    }
                    if (jsonSupported && err.message.includes("invalid option")) {
                        setJsonSupported(false);
                        return;
                    }
                    setAlert({ msg: err.message, variant: "warning" });
                });
    }, [installed, loading, jsonSupported]);

    // ---------------------------------------- //
    // Helpers
    // ---------------------------------------- //
    const getLmSensorsInstallCmd = async (): Promise<string[] | undefined> => {
        let osIds: string[] = [];
        try {
            osIds = getOsIds(await cockpit.file("/etc/os-release").read());
        } catch (err: unknown) {
            setAlert({
                msg: cockpit.format(_("Unable to detect OS: $0"), (err as Error).message),
                variant: "danger",
            });
            return undefined;
        }

        for (const osId of osIds) {
            switch (osId) {
            case "alpine":
                return ["apk", "add", "--no-cache", "lm-sensors"];
            case "debian":
            case "ubuntu":
                return ["apt-get", "install", "-y", "lm-sensors"];
            case "fedora":
            case "rhel":
            case "centos":
                return ["dnf", "install", "-y", "lm_sensors"];
            case "suse":
            case "opensuse":
                return ["zypper", "install", "-y", "sensors"];
            case "arch":
                return ["pacman", "-S", "--noconfirm", "lm_sensors"];
            }
        }

        setAlert({ msg: cockpit.format(_("Unsupported OS: $0"), osIds[0] ?? "unknown"), variant: "danger" });
        return undefined;
    };

    const installSensors = async () => {
        const installCmd = await getLmSensorsInstallCmd();
        if (!installCmd) {
            return;
        }

        setLoading(true);
        setAlert(null);

        try {
            await cockpit.spawn(installCmd, { err: "message", superuser: "require" });
            await cockpit.spawn(["sensors-detect", "--auto"], { err: "message", superuser: "require" });

            // Load the kernel modules that sensors-detect added to /etc/modules (Debian based systems)
            const contents: string | null = await cockpit.file("/etc/modules").read();
            const modules = (contents ?? "")
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => /^[a-zA-Z0-9_-]+$/.test(line));
            await Promise.allSettled(modules.map((mod) =>
                cockpit.spawn(["modprobe", mod], { err: "message", superuser: "require" })
            ));

            setInstalled(true);
        } catch (err: unknown) {
            setAlert({ msg: (err as Error).message, variant: "warning" });
        } finally {
            setLoading(false);
        }
    };

    const extractSensorGroup = (chip: SensorChipGroup, prefix: string) => {
        const rows: Record<string, Record<string, number>> = {};
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

    const getAllKeys = (rows: Record<string, Record<string, number>>) => {
        const allKeys = new Set<string>();
        for (const row of Object.values(rows)) {
            Object.keys(row).forEach((key) => allKeys.add(key));
        }
        return Array.from(allKeys);
    };

    const formatSensorKey = (key: string): string => {
        const idx = key.indexOf("_");
        return idx !== -1 ? key.slice(idx + 1) : key;
    };

    const formatSensorValue = (categoryKey: string, key: string, value: number): string => {
        if (isFlagKey(key)) {
            return String(value);
        }
        if (categoryKey === "temp") {
            return fahrenheitChecked
                ? `${((value * 9) / 5 + 32).toFixed(1)} °F`
                : `${value.toFixed(1)} °C`;
        }
        return categoryKey === "fan" ? value.toFixed(0) : value.toFixed(2);
    };

    // ---------------------------------------- //
    // Effects
    // ---------------------------------------- //
    useEffect(() => {
        const id = window.setInterval(() => {
            loadSensors();
        }, 1000);

        return () => clearInterval(id);
    }, [loadSensors]);

    // ---------------------------------------- //
    // Components
    // ---------------------------------------- //
    const SensorTable = ({
        category,
        chipData,
    }: {
        category: SensorCategory;
        chipData: SensorChipGroup;
    }) => {
        const rows = extractSensorGroup(chipData, category.key);
        if (!Object.keys(rows).length) {
            return null;
        }

        const allKeys = getAllKeys(rows);

        // Map stripped keys to a representative full key
        const displayKeyMap: Record<string, string> = {};
        for (const fullKey of allKeys) {
            const stripped = formatSensorKey(fullKey);
            if (!(stripped in displayKeyMap)) {
                displayKeyMap[stripped] = fullKey;
            }
        }

        const strippedKeys = Object.keys(displayKeyMap);

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
                                <Th>{_("Label")}</Th>
                                {strippedKeys.map((strippedKey) => (
                                    <Th key={strippedKey}>{strippedKey}</Th>
                                ))}
                            </Tr>
                        </Thead>
                        <Tbody>
                            {Object.entries(rows).map(([label, values]) => {
                                const max = Object.entries(values).find(([key]) => formatSensorKey(key) === "max")?.[1];
                                return (
                                    <Tr key={label}>
                                        <Td dataLabel={_("Label")}>{label}</Td>
                                        {strippedKeys.map((strippedKey) => {
                                            const value = Object.entries(values).find(
                                                ([key]) => formatSensorKey(key) === strippedKey,
                                            )?.[1];
                                            const critical = strippedKey === "input" && typeof value === "number" &&
                                                typeof max === "number" && max !== 0 && value > max;
                                            return (
                                                <Td
                                                    key={strippedKey}
                                                    dataLabel={strippedKey}
                                                    className={critical ? "sensors-value-critical" : ""}
                                                >
                                                    {typeof value === "number"
                                                        ? formatSensorValue(category.key, strippedKey, value)
                                                        : "—"}
                                                </Td>
                                            );
                                        })}
                                    </Tr>
                                );
                            })}
                        </Tbody>
                    </Table>
                </CardBody>
            </Card>
        );
    };

    // ---------------------------------------- //
    // Render
    // ---------------------------------------- //
    return (
        <Page id="sensors" className="pf-m-no-sidebar">
            {alert != null &&
                <PageSection hasBodyWrapper={false}>
                    <Alert
                        isInline
                        variant={alert.variant}
                        title={alert.msg}
                        actionClose={<AlertActionCloseButton onClose={() => setAlert(null)} />}
                    />
                </PageSection>}
            <PageSection hasBodyWrapper={false}>
                <Flex justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
                    <Stack hasGutter>
                        <Title headingLevel="h1">{_("Sensors")}</Title>
                        <Checkbox
                            label={_("Show temperature in Fahrenheit")}
                            isChecked={fahrenheitChecked}
                            onChange={(_event, checked) => {
                                setFahrenheitChecked(checked);
                                localStorage.setItem("fahrenheitChecked", String(checked));
                            }}
                            id="fahrenheit-checkbox"
                            name="fahrenheit-checkbox"
                        />
                    </Stack>
                    {!installed &&
                        <Button
                            variant="primary"
                            isLoading={loading}
                            isDisabled={loading}
                            onClick={installSensors}
                        >
                            {_("Install lm-sensors")}
                        </Button>}
                </Flex>
            </PageSection>
            {Object.keys(sensorData).length > 0 &&
                <PageSection hasBodyWrapper={false}>
                    <Tabs
                        activeKey={activeTabKey}
                        onSelect={(_event, eventKey) => setActiveTabKey(eventKey)}
                    >
                        {Object.entries(sensorData).map(([chipName, chipData], index) => (
                            <Tab
                                key={chipName}
                                eventKey={index}
                                title={<TabTitleText>{chipName}</TabTitleText>}
                            >
                                <p className="sensors-adapter">
                                    {cockpit.format(_("Adapter: $0"), chipData.Adapter ?? _("unknown"))}
                                </p>
                                <Stack hasGutter>
                                    {sensorCategories.map((category) => (
                                        <StackItem key={category.key}>
                                            <SensorTable category={category} chipData={chipData} />
                                        </StackItem>
                                    ))}
                                </Stack>
                            </Tab>
                        ))}
                    </Tabs>
                </PageSection>}
        </Page>
    );
};

export { Application };
