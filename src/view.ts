/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Display settings and actions shared by the overview and the sensor tables.
 */

import React, { useContext } from "react";

import type { HistoryStatus } from "./history";
import type { TrendRecorder } from "./trend";

export type SensorView = {
    fahrenheit: boolean;
    // lowercase text to filter sensors by
    filter: string;
    // keys of hidden chips (chip name) and sensors (sensorKey())
    hidden: Set<string>;
    showHidden: boolean;
    // user-given names, by the same keys as hidden
    aliases: Record<string, string>;
    trends: TrendRecorder;
    historyStatus: HistoryStatus;
    expanded: Set<string>;
    onToggleExpanded: (metric: string) => void;
    onEnableHistory: () => void;
    onSetHidden: (key: string, hidden: boolean) => void;
    onRename: (key: string, name: string) => void;
};

export const SensorViewContext = React.createContext<SensorView | null>(null);

export const useSensorView = (): SensorView => {
    const view = useContext(SensorViewContext);
    if (!view)
        throw new Error("useSensorView() outside of SensorViewContext");
    return view;
};

// whether a sensor matches the filter, by its label or its user-given name
export const matchesFilter = (view: SensorView, label: string, alias: string | undefined): boolean =>
    !view.filter || label.toLowerCase().includes(view.filter) || !!alias?.toLowerCase().includes(view.filter);

export const isVisible = (view: SensorView, key: string): boolean => view.showHidden || !view.hidden.has(key);
