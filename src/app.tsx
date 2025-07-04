/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import type { SVGIconProps } from "@patternfly/react-icons/dist/esm/createIcon";

import {
    Alert,
    AlertActionCloseButton,
    Button,
    Flex,
    Page,
    PageSection,
    Stack,
    StackItem,
    Tab,
    Tabs,
    TabTitleText,
    Title,
} from "@patternfly/react-core";
import {
    ChargingStationIcon,
    FanIcon,
    ThermometerHalfIcon,
} from "@patternfly/react-icons";
import {
    Caption,
    Table,
    Tbody,
    Td,
    Th,
    Thead,
    Tr,
} from "@patternfly/react-table";
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
        label: "Fans",
        icon: FanIcon,
    },
    {
        key: "in",
        label: "Voltages",
        icon: ChargingStationIcon,
    },
    {
        key: "temp",
        label: "Temperatures",
        icon: ThermometerHalfIcon,
    },
];

const Application = () => {
    // ---------------------------------------- //
    // Hooks
    // ---------------------------------------- //
    const [installed, setInstalled] = useState<boolean>(true);
    const [loading, setLoading] = useState<boolean>(false);
    const [alert, setAlert] = useState<AlertInfo>(null);

    const [activeTabKey, setActiveTabKey] = useState<string | number>(0);
    const [sensorData, setSensorData] = useState<SensorData>({});

    // ---------------------------------------- //
    // Callbacks
    // ---------------------------------------- //
    const loadSensors = useCallback(() => {
        if (loading || !installed) {
            return;
        }
        cockpit
                .spawn(["sensors", "-j"], { err: "message", superuser: "try" })
                .done((output: string) => {
                    const parsed = JSON.parse(output);
                    setSensorData(parsed);
                })
                .fail((err: { message: string }) => {
                    if (err.message === "not-found") {
                        setInstalled(false);
                        setAlert({
                            msg: _("lm-sensors not found, do you want to install it?"),
                            variant: "danger",
                        });
                        return;
                    }
                    setAlert({ msg: err.message, variant: "warning" });
                });
    }, [installed, loading]);

    // ---------------------------------------- //
    // Helpers
    // ---------------------------------------- //
    const getLmSensorsInstallCmd = async (): Promise<string[] | undefined> => {
        try {
            const content = await cockpit.file("/etc/os-release").read();
            const idMatch = /^ID=(.+)$/m.exec(content);
            const osId = idMatch?.[1].replace(/"/g, "");

            switch (osId) {
            case "alpine":
                return ["apk", "add", "--no-cache", "lm-sensors", "-y"];
            case "debian":
            case "ubuntu":
                return ["apt-get", "install", "lm-sensors", "-y"];
            case "fedora":
            case "rhel":
            case "centos":
                return ["dnf", "install", "lm_sensors", "-y"];
            case "opensuse":
                return ["zypper", "install", "-y", "sensors"];
            default:
                setAlert({ msg: `Unsupported OS: ${osId}`, variant: "danger" });
            }
        } catch (err: unknown) {
            setAlert({
                msg: `Unable to detect OS: ${(err as Error).message}`,
                variant: "danger",
            });
        }
        return undefined;
    };

    const installSensors = async () => {
        const installCmd = await getLmSensorsInstallCmd();
        if (!installCmd) {
            return;
        }

        setLoading(true);
        setAlert(null);

        // Install lm-sensors
        cockpit
                .spawn(installCmd, { err: "message", superuser: "require" })
                .done(() => {
                    // Parse the modules listed in /etc/modules
                    cockpit
                            .spawn(["sensors-detect", "--auto"], {
                                err: "message",
                                superuser: "require",
                            })
                            .done(() => {
                                // Parse the modules listed in /etc/modules
                                cockpit
                                        .file("/etc/modules")
                                        .read()
                                        .then((contents: string) => {
                                            const moduleLines = contents
                                                    .split("\n")
                                                    .map((line) => line.trim())
                                                    .filter((line) => /^[a-zA-Z0-9_-]+$/.test(line));

                                            moduleLines.forEach((mod) =>
                                                cockpit.spawn(["modprobe", mod], {
                                                    err: "message",
                                                    superuser: "require",
                                                }),
                                            );

                                            setInstalled(true);
                                            setAlert(null);
                                        });
                            })
                            .fail((err: unknown) => {
                                setAlert({ msg: (err as Error).message, variant: "warning" });
                            });
                })
                .fail((err: unknown) => {
                    setAlert({ msg: (err as Error).message, variant: "warning" });
                });

        setLoading(false);
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
            <Table>
                <Caption>
                    <Flex>
                        <category.icon />
                        {category.label}
                    </Flex>
                </Caption>
                <Thead>
                    <Tr>
                        <Th>Label</Th>
                        {strippedKeys.map((strippedKey) => (
                            <Th key={strippedKey}>{strippedKey}</Th>
                        ))}
                    </Tr>
                </Thead>
                <Tbody>
                    {Object.entries(rows).map(([label, values]) => (
                        <Tr key={label}>
                            <Td dataLabel="Label">{label}</Td>
                            {strippedKeys.map((strippedKey) => {
                                const matchingEntry = Object.entries(values).find(
                                    ([key]) => formatSensorKey(key) === strippedKey,
                                );
                                const value = matchingEntry?.[1];
                                return (
                                    <Td key={strippedKey} dataLabel={strippedKey}>
                                        {typeof value === "number" ? value.toFixed(2) : "—"}
                                    </Td>
                                );
                            })}
                        </Tr>
                    ))}
                </Tbody>
            </Table>
        );
    };

    // ---------------------------------------- //
    // Render
    // ---------------------------------------- //
    return (
        <Page>
            {alert != null
                ? (
                    <Alert
                    variant={alert.variant}
                    title={undefined}
                    actionClose={
                        <AlertActionCloseButton onClose={() => setAlert(null)} />
                    }
                    >
                        {alert.msg}
                    </Alert>
                )
                : null}
            <PageSection>
                <Flex justifyContent={{ default: "justifyContentSpaceBetween" }}>
                    <Title headingLevel="h1">{_("Sensors")}</Title>
                    <Button
                        variant="control"
                        isDisabled={installed}
                        isLoading={loading}
                        onClick={installSensors}
                    >
                        Install lm-sensors
                    </Button>
                </Flex>
            </PageSection>
            <PageSection>
                <Stack>
                    <StackItem>
                        <Tabs
                        activeKey={activeTabKey}
                        onSelect={(_, eventKey) => setActiveTabKey(eventKey)}
                        >
                            {Object.entries(sensorData).map(([chipName, chipData], index) => (
                                <Tab
                                key={chipName}
                                eventKey={index}
                                title={<TabTitleText>{chipName}</TabTitleText>}
                                >
                                    <Title headingLevel="h3">
                                        Adapter: {chipData.Adapter ?? "unknown"}
                                    </Title>
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
                    </StackItem>
                </Stack>
            </PageSection>
        </Page>
    );
};

export { Application };
