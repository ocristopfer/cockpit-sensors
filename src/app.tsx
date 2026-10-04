/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2017 Red Hat, Inc.
 */

import { Alert, AlertActionCloseButton } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Tab, Tabs, TabTitleText } from "@patternfly/react-core/dist/esm/components/Tabs/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import cockpit from "cockpit";
import React, { useCallback, useEffect, useState } from "react";

import { enableHistory, getHistoryStatus, pcpPackages } from "./history";
import type { HistoryStatus } from "./history";
import { SensorTable } from "./SensorTable";
import { extractSensorGroup, parseSensorsRaw, readOsIds, sensorCategories } from "./sensors";
import type { SensorData } from "./sensors";

const _ = cockpit.gettext;

type AlertInfo = {
    msg: string;
    variant: "danger" | "warning" | "info" | "success";
} | null;

const EnableHistoryModal = ({ onClose, onEnabled }: { onClose: () => void; onEnabled: () => void }) => {
    const [packages, setPackages] = useState<string[] | null | undefined>(undefined);
    const [osIds, setOsIds] = useState<string[]>([]);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        readOsIds()
                .then(ids => {
                    setOsIds(ids);
                    setPackages(pcpPackages(ids));
                })
                .catch(() => setPackages(null));
    }, []);

    const enable = () => {
        setRunning(true);
        setError(null);
        enableHistory(osIds)
                .then(onEnabled)
                .catch((err: Error) => {
                    setError(err.message);
                    setRunning(false);
                });
    };

    return (
        <Modal isOpen variant="medium" onClose={running ? undefined : onClose} aria-labelledby="enable-history-title">
            <ModalHeader title={_("Enable sensor history")} labelId="enable-history-title" />
            <ModalBody>
                <Content>
                    <p>
                        {_("Sensor history is recorded with Performance Co-Pilot (PCP), the same service that powers Cockpit's Metrics and history page.")}
                    </p>
                    {packages === null
                        ? <p>{_("PCP packages are not available for this distribution. Install PCP and its lm-sensors agent manually.")}</p>
                        : (
                            <>
                                <p>{_("This will:")}</p>
                                <ul>
                                    <li>
                                        {packages
                                            ? cockpit.format(_("install the packages $0, if missing"), packages.join(", "))
                                            : _("install PCP, if missing")}
                                    </li>
                                    <li>{_("enable the PCP lm-sensors agent (pmdalmsensors)")}</li>
                                    <li>{_("record all sensor readings every minute with pmlogger")}</li>
                                </ul>
                                <p>
                                    {_("History is kept as long as pmlogger keeps its archives (14 days by default).")}
                                </p>
                            </>
                        )}
                </Content>
                {error && <Alert isInline variant="danger" title={_("Enabling sensor history failed")}>{error}</Alert>}
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" onClick={enable} isLoading={running} isDisabled={running || !packages}>
                    {_("Enable")}
                </Button>
                <Button variant="link" onClick={onClose} isDisabled={running}>
                    {_("Cancel")}
                </Button>
            </ModalFooter>
        </Modal>
    );
};

const Application = () => {
    const [installed, setInstalled] = useState<boolean>(true);
    const [loading, setLoading] = useState<boolean>(false);
    const [alert, setAlert] = useState<AlertInfo>(null);

    const [activeTabKey, setActiveTabKey] = useState<string | number>(0);
    const [sensorData, setSensorData] = useState<SensorData>({});
    const [jsonSupported, setJsonSupported] = useState<boolean>(true);
    const [fahrenheitChecked, setFahrenheitChecked] = useState<boolean>(
        () => localStorage.getItem("fahrenheitChecked") === "true"
    );

    const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("loading");
    const [showEnableHistory, setShowEnableHistory] = useState<boolean>(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

    const refreshHistoryStatus = useCallback(() => {
        getHistoryStatus()
                .then(setHistoryStatus)
                .catch(() => setHistoryStatus("no-pcp"));
    }, []);

    const getLmSensorsInstallCmd = async (): Promise<string[] | undefined> => {
        let osIds: string[] = [];
        try {
            osIds = await readOsIds();
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

    const toggleExpanded = (metric: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(metric))
                next.delete(metric);
            else
                next.add(metric);
            return next;
        });
    };

    useEffect(() => {
        const id = window.setInterval(() => {
            loadSensors();
        }, 1000);

        return () => clearInterval(id);
    }, [loadSensors]);

    useEffect(refreshHistoryStatus, [refreshHistoryStatus]);

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
                    {installed && historyStatus !== "loading" && historyStatus !== "enabled" &&
                        <Button variant="secondary" onClick={() => setShowEnableHistory(true)}>
                            {_("Enable history")}
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
                                    {sensorCategories.filter((category) => Object.keys(extractSensorGroup(chipData, category.key)).length > 0).map((category) => (
                                        <StackItem key={category.key}>
                                            <SensorTable
                                                chipName={chipName}
                                                chipData={chipData}
                                                category={category}
                                                fahrenheit={fahrenheitChecked}
                                                expanded={expanded}
                                                onToggle={toggleExpanded}
                                                historyStatus={historyStatus}
                                                onEnableHistory={() => setShowEnableHistory(true)}
                                            />
                                        </StackItem>
                                    ))}
                                </Stack>
                            </Tab>
                        ))}
                    </Tabs>
                </PageSection>}
            {showEnableHistory &&
                <EnableHistoryModal
                    onClose={() => setShowEnableHistory(false)}
                    onEnabled={() => {
                        setShowEnableHistory(false);
                        refreshHistoryStatus();
                    }}
                />}
        </Page>
    );
};

export { Application };
