/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2017 Red Hat, Inc.
 */

import { Alert, AlertActionCloseButton } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { EmptyState, EmptyStateActions, EmptyStateBody, EmptyStateFooter } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { SearchInput } from "@patternfly/react-core/dist/esm/components/SearchInput/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { Tab, Tabs, TabTitleText } from "@patternfly/react-core/dist/esm/components/Tabs/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { ToggleGroup, ToggleGroupItem } from "@patternfly/react-core/dist/esm/components/ToggleGroup/index.js";
import { Toolbar, ToolbarContent, ToolbarGroup, ToolbarItem } from "@patternfly/react-core/dist/esm/components/Toolbar/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { EyeIcon } from "@patternfly/react-icons/dist/esm/icons/eye-icon.js";
import { EyeSlashIcon } from "@patternfly/react-icons/dist/esm/icons/eye-slash-icon.js";
import { PenIcon } from "@patternfly/react-icons/dist/esm/icons/pen-icon.js";
import { SearchIcon } from "@patternfly/react-icons/dist/esm/icons/search-icon.js";
import { ThermometerHalfIcon } from "@patternfly/react-icons/dist/esm/icons/thermometer-half-icon.js";
import cockpit from "cockpit";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { enableHistory, getHistoryStatus, pcpPackages } from "./history";
import type { HistoryStatus } from "./history";
import { page_status } from "notifications";

import { Overview } from "./Overview";
import { usePreference } from "./preferences";
import { SensorName, SensorTable } from "./SensorTable";
import { chipDisplayNames, extractSensorGroup, parseSensorsRaw, readOsIds, sensorCategories, worstLevel } from "./sensors";
import type { SensorData } from "./sensors";
import { StatusIcon } from "./StatusIcon";
import { StatusTracker } from "./status";
import { sensorKey, TrendRecorder } from "./trend";
import { alertLevel, isVisible, matchesFilter, SensorViewContext } from "./view";
import type { SensorView } from "./view";

const _ = cockpit.gettext;

type AlertInfo = {
    msg: string;
    variant: "danger" | "warning" | "info" | "success";
    // set for errors of the periodic sensors reading, which clear themselves once reading works again
    fromPolling?: boolean;
} | null;

const OVERVIEW_TAB = "overview";
const refreshIntervals = [1, 2, 5, 10];
// while the page is in the background, keep reading the sensors this often (ms) for the alert in Cockpit's menu
const BACKGROUND_INTERVAL = 30 * 1000;

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

const RenameModal = ({ name, alias, onSave, onClose }: {
    name: string;
    alias: string;
    onSave: (alias: string) => void;
    onClose: () => void;
}) => {
    const [value, setValue] = useState(alias);

    return (
        <Modal isOpen variant="small" onClose={onClose} aria-labelledby="rename-title">
            <ModalHeader title={cockpit.format(_("Rename $0"), name)} labelId="rename-title" />
            <ModalBody>
                <Form id="rename-form" onSubmit={event => { event.preventDefault(); onSave(value.trim()) }}>
                    <FormGroup label={_("Name")} fieldId="rename-input">
                        <TextInput id="rename-input" value={value} placeholder={name} onChange={(_event, v) => setValue(v)} autoFocus />
                    </FormGroup>
                    <p className="sensors-original-name">{_("Leave empty to use the original name. Names are remembered in this browser.")}</p>
                </Form>
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" type="submit" form="rename-form">{_("Save")}</Button>
                <Button variant="link" onClick={onClose}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
};

// lm-sensors reports this, and exits with an error, when no driver exposes any sensor
const isNoSensorsError = (message: string): boolean => message.includes("No sensors found");

// run sensors-detect and load the kernel drivers it found
const detectSensors = async (): Promise<void> => {
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
};

const Application = () => {
    const [installed, setInstalled] = useState<boolean>(true);
    const [loading, setLoading] = useState<boolean>(false);
    const [detecting, setDetecting] = useState<boolean>(false);
    const [alert, setAlert] = useState<AlertInfo>(null);

    const [activeTabKey, setActiveTabKey] = useState<string>(OVERVIEW_TAB);
    const [sensorData, setSensorData] = useState<SensorData>({});
    const [loaded, setLoaded] = useState<boolean>(false);
    const [trends] = useState(() => new TrendRecorder());
    const [statuses] = useState(() => new StatusTracker());

    const [fahrenheit, setFahrenheit] = usePreference<boolean>("fahrenheitChecked", false);
    const [refreshInterval, setRefreshInterval] = usePreference<number>("refreshInterval", 1);
    const [hiddenList, setHiddenList] = usePreference<string[]>("hiddenSensors", []);
    const [aliases, setAliases] = usePreference<Record<string, string>>("sensorAliases", {});
    const [mutedList, setMutedList] = usePreference<string[]>("mutedSensors", []);
    const [showHidden, setShowHidden] = useState<boolean>(false);
    const [filter, setFilter] = useState<string>("");
    const [renaming, setRenaming] = useState<{ key: string; name: string } | null>(null);

    const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("loading");
    const [showEnableHistory, setShowEnableHistory] = useState<boolean>(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    // whether `sensors -j` works; older lm-sensors only have `sensors -u`
    const jsonSupported = useRef<boolean>(true);
    // a `sensors` call is running, don't start another one
    const reading = useRef<boolean>(false);
    // the last error shown for reading the sensors, to show each one only once
    const lastError = useRef<string | null>(null);
    // when the sensors were last read
    const lastRead = useRef<number>(0);

    const showPollingError = (msg: string) => {
        if (lastError.current === msg)
            return;
        lastError.current = msg;
        setAlert({ msg, variant: "warning", fromPolling: true });
    };

    const receiveData = (data: SensorData) => {
        if (lastError.current !== null) {
            lastError.current = null;
            setAlert(prev => prev?.fromPolling ? null : prev);
        }
        trends.record(data);
        statuses.update(data);
        lastRead.current = Date.now();
        setSensorData(data);
        setLoaded(true);
    };

    const loadSensors = useCallback(() => {
        if (reading.current)
            return;
        reading.current = true;
        const json = jsonSupported.current;

        cockpit
                .spawn(["sensors", json ? "-j" : "-u"], { err: "message", superuser: "try" })
                .then((output: string) => {
                    if (!json) {
                        receiveData(parseSensorsRaw(output));
                        return;
                    }
                    try {
                        receiveData(JSON.parse(output));
                    } catch {
                        // some lm-sensors versions emit invalid JSON for unreadable sub-features
                        jsonSupported.current = false;
                    }
                })
                .catch((err: { message: string, problem?: string }) => {
                    if (err.problem === "not-found" || err.message === "not-found") {
                        setInstalled(false);
                        setAlert({
                            msg: _("lm-sensors not found, do you want to install it?"),
                            variant: "danger",
                        });
                        return;
                    }
                    if (isNoSensorsError(err.message)) {
                        receiveData({});
                        return;
                    }
                    if (json && err.message.includes("invalid option")) {
                        jsonSupported.current = false;
                        return;
                    }
                    showPollingError(err.message);
                })
                .finally(() => { reading.current = false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
            await detectSensors();
            setInstalled(true);
        } catch (err: unknown) {
            setAlert({ msg: (err as Error).message, variant: "warning" });
        } finally {
            setLoading(false);
        }
    };

    const runDetectSensors = async () => {
        setDetecting(true);
        try {
            await detectSensors();
            loadSensors();
        } catch (err: unknown) {
            setAlert({ msg: cockpit.format(_("Detecting sensors failed: $0"), (err as Error).message), variant: "warning" });
        } finally {
            setDetecting(false);
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

    // read the sensors periodically; rarely while the page is in the background
    useEffect(() => {
        if (!installed || loading)
            return;

        const tick = () => {
            if (!cockpit.hidden || Date.now() - lastRead.current >= BACKGROUND_INTERVAL)
                loadSensors();
        };
        tick();
        const id = window.setInterval(tick, refreshInterval * 1000);
        cockpit.addEventListener("visibilitychange", tick);

        return () => {
            clearInterval(id);
            cockpit.removeEventListener("visibilitychange", tick);
        };
    }, [installed, loading, loadSensors, refreshInterval]);

    useEffect(refreshHistoryStatus, [refreshHistoryStatus]);

    const hidden = new Set(hiddenList);
    const view: SensorView = {
        fahrenheit,
        filter: filter.trim().toLowerCase(),
        hidden,
        showHidden,
        aliases,
        muted: new Set(mutedList),
        trends,
        statuses,
        historyStatus,
        expanded,
        onToggleExpanded: toggleExpanded,
        onEnableHistory: () => setShowEnableHistory(true),
        onSetHidden: (key, hide) => {
            const next = hide ? [...hiddenList, key] : hiddenList.filter(k => k !== key);
            setHiddenList(next);
            if (next.length === 0)
                setShowHidden(false);
        },
        onRename: (key, name) => setRenaming({ key, name }),
        onSetMuted: (key, mute) => setMutedList(mute ? [...mutedList, key] : mutedList.filter(k => k !== key)),
    };

    const chipNames = chipDisplayNames(Object.keys(sensorData));
    const visibleChips = Object.entries(sensorData).filter(([chipName]) => isVisible(view, chipName));

    // sensors in trouble, for the icon next to "Sensors" in Cockpit's menu
    const alertLevels = Object.entries(sensorData).flatMap(([chipName, chipData]) =>
        sensorCategories.flatMap(category =>
            Object.entries(extractSensorGroup(chipData, category.key))
                    .map(([label, values]) => alertLevel(view, chipName, label, category.key, values))));
    const criticalCount = alertLevels.filter(level => level === "critical").length;
    const warningCount = alertLevels.filter(level => level === "warning").length;

    useEffect(() => {
        if (criticalCount + warningCount === 0) {
            page_status.set_own(null);
            return;
        }
        page_status.set_own({
            type: criticalCount ? "error" : "warning",
            title: criticalCount
                ? cockpit.format(cockpit.ngettext("$0 sensor is critical", "$0 sensors are critical", criticalCount), criticalCount)
                : cockpit.format(cockpit.ngettext("$0 sensor needs attention", "$0 sensors need attention", warningCount), warningCount),
        });
    }, [criticalCount, warningCount]);
    const activeTab = visibleChips.some(([chipName]) => chipName === activeTabKey) ? activeTabKey : OVERVIEW_TAB;

    const chipTab = (chipName: string, chipData: SensorData[string]) => {
        const alias = aliases[chipName];
        const chipHidden = hidden.has(chipName);
        const levels = sensorCategories.flatMap(category =>
            Object.entries(extractSensorGroup(chipData, category.key))
                    .map(([label, values]) => alertLevel(view, chipName, label, category.key, values)));
        const tables = sensorCategories.filter(category =>
            Object.entries(extractSensorGroup(chipData, category.key)).some(([label]) => {
                const key = sensorKey(chipName, label);
                return isVisible(view, key) && matchesFilter(view, label, aliases[key]);
            }));

        return (
            <Tab
                key={chipName}
                eventKey={chipName}
                title={
                    <TabTitleText>
                        <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }} flexWrap={{ default: "nowrap" }}>
                            <span>{alias || chipNames[chipName]}</span>
                            <StatusIcon level={worstLevel(levels)} />
                        </Flex>
                    </TabTitleText>
                }
            >
                <Flex className="sensors-adapter" justifyContent={{ default: "justifyContentSpaceBetween" }} alignItems={{ default: "alignItemsCenter" }}>
                    <Flex spaceItems={{ default: "spaceItemsSm" }} alignItems={{ default: "alignItemsCenter" }}>
                        <SensorName name={chipName} alias={alias} hidden={chipHidden} />
                        <span>·</span>
                        <span>{cockpit.format(_("Adapter: $0"), chipData.Adapter ?? _("unknown"))}</span>
                    </Flex>
                    <Flex spaceItems={{ default: "spaceItemsMd" }}>
                        <Button variant="link" isInline icon={<PenIcon />} onClick={() => setRenaming({ key: chipName, name: chipNames[chipName] })}>
                            {_("Rename")}
                        </Button>
                        <Button
                            variant="link"
                            isInline
                            icon={chipHidden ? <EyeIcon /> : <EyeSlashIcon />}
                            onClick={() => view.onSetHidden(chipName, !chipHidden)}
                        >
                            {chipHidden ? _("Show this chip") : _("Hide this chip")}
                        </Button>
                    </Flex>
                </Flex>
                {tables.length === 0
                    ? (
                        <EmptyState headingLevel="h2" icon={SearchIcon} titleText={_("No matching sensors")} variant="sm">
                            <EmptyStateBody>
                                {view.filter ? _("No sensor of this chip matches the filter.") : _("All sensors of this chip are hidden.")}
                            </EmptyStateBody>
                        </EmptyState>
                    )
                    : (
                        <Stack hasGutter>
                            {tables.map(category => (
                                <StackItem key={category.key}>
                                    <SensorTable chipName={chipName} chipData={chipData} category={category} />
                                </StackItem>
                            ))}
                        </Stack>
                    )}
            </Tab>
        );
    };

    let body;
    if (!installed || (!loaded && !alert)) {
        body = !installed ? null : <Spinner size="xl" className="sensors-loading" />;
    } else if (loaded && Object.keys(sensorData).length === 0) {
        body = (
            <EmptyState headingLevel="h2" icon={ThermometerHalfIcon} titleText={_("No sensors found")}>
                <EmptyStateBody>
                    {_("lm-sensors does not report any sensor. Detecting sensors probes your hardware and loads the kernel drivers it needs (administrator access required).")}
                </EmptyStateBody>
                <EmptyStateFooter>
                    <EmptyStateActions>
                        <Button variant="primary" onClick={runDetectSensors} isLoading={detecting} isDisabled={detecting}>
                            {_("Detect sensors")}
                        </Button>
                    </EmptyStateActions>
                </EmptyStateFooter>
            </EmptyState>
        );
    } else if (loaded) {
        body = (
            <Tabs mountOnEnter unmountOnExit activeKey={activeTab} onSelect={(_event, eventKey) => setActiveTabKey(String(eventKey))}>
                {[
                    <Tab key={OVERVIEW_TAB} eventKey={OVERVIEW_TAB} title={<TabTitleText>{_("Overview")}</TabTitleText>}>
                        <div className="sensors-tab-body">
                            <Overview sensorData={sensorData} chipNames={chipNames} onSelect={setActiveTabKey} />
                        </div>
                    </Tab>,
                    ...visibleChips.map(([chipName, chipData]) => chipTab(chipName, chipData)),
                ]}
            </Tabs>
        );
    }

    return (
        <SensorViewContext.Provider value={view}>
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
                        <Title headingLevel="h1">{_("Sensors")}</Title>
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
                    {installed &&
                        <Toolbar className="sensors-toolbar">
                            <ToolbarContent>
                                <ToolbarItem>
                                    <SearchInput
                                        id="sensors-filter"
                                        placeholder={_("Filter sensors")}
                                        value={filter}
                                        onChange={(_event, value) => setFilter(value)}
                                        onClear={() => setFilter("")}
                                    />
                                </ToolbarItem>
                                <ToolbarItem>
                                    <ToggleGroup isCompact aria-label={_("Temperature unit")}>
                                        <ToggleGroupItem
                                            text="°C"
                                            buttonId="unit-celsius"
                                            isSelected={!fahrenheit}
                                            onChange={() => setFahrenheit(false)}
                                        />
                                        <ToggleGroupItem
                                            text="°F"
                                            buttonId="unit-fahrenheit"
                                            isSelected={fahrenheit}
                                            onChange={() => setFahrenheit(true)}
                                        />
                                    </ToggleGroup>
                                </ToolbarItem>
                                <ToolbarItem>
                                    <FormSelect
                                        id="refresh-interval"
                                        aria-label={_("Refresh interval")}
                                        value={refreshInterval}
                                        onChange={(_event, value) => setRefreshInterval(Number(value))}
                                    >
                                        {refreshIntervals.map(seconds => (
                                            <FormSelectOption
                                                key={seconds}
                                                value={seconds}
                                                label={cockpit.format(cockpit.ngettext("Refresh every $0 second", "Refresh every $0 seconds", seconds), seconds)}
                                            />
                                        ))}
                                    </FormSelect>
                                </ToolbarItem>
                                {hiddenList.length > 0 &&
                                    <ToolbarGroup>
                                        <ToolbarItem>
                                            <Switch
                                                id="show-hidden"
                                                label={cockpit.format(_("Show hidden ($0)"), hiddenList.length)}
                                                isChecked={showHidden}
                                                onChange={(_event, checked) => setShowHidden(checked)}
                                            />
                                        </ToolbarItem>
                                    </ToolbarGroup>}
                            </ToolbarContent>
                        </Toolbar>}
                </PageSection>
                {body &&
                    <PageSection hasBodyWrapper={false}>
                        {body}
                    </PageSection>}
                {showEnableHistory &&
                    <EnableHistoryModal
                        onClose={() => setShowEnableHistory(false)}
                        onEnabled={() => {
                            setShowEnableHistory(false);
                            refreshHistoryStatus();
                        }}
                    />}
                {renaming &&
                    <RenameModal
                        name={renaming.name}
                        alias={aliases[renaming.key] ?? ""}
                        onClose={() => setRenaming(null)}
                        onSave={alias => {
                            const next = { ...aliases };
                            if (alias)
                                next[renaming.key] = alias;
                            else
                                delete next[renaming.key];
                            setAliases(next);
                            setRenaming(null);
                        }}
                    />}
            </Page>
        </SensorViewContext.Provider>
    );
};

export { Application };
