/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import { ExclamationCircleIcon } from "@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon.js";
import { ExclamationTriangleIcon } from "@patternfly/react-icons/dist/esm/icons/exclamation-triangle-icon.js";
import cockpit from "cockpit";
import React from "react";

import type { SensorStatusLevel } from "./sensors";

const _ = cockpit.gettext;

// a warning or critical icon, nothing when everything is fine
export const StatusIcon = ({ level }: { level: SensorStatusLevel }) => {
    if (level === "critical")
        return <ExclamationCircleIcon className="sensors-status-icon-critical" aria-label={_("Critical")} />;
    if (level === "warning")
        return <ExclamationTriangleIcon className="sensors-status-icon-warning" aria-label={_("Warning")} />;
    return null;
};
