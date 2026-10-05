/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * The status of every sensor, updated with each reading. Keeping the previous
 * status lets sensorStatus() apply the chip's hysteresis.
 */

import { extractSensorGroup, sensorCategories, sensorStatus } from "./sensors";
import type { SensorData, SensorStatus, SensorValueGroup } from "./sensors";
import { sensorKey } from "./trend";

export class StatusTracker {
    private statuses = new Map<string, SensorStatus>();

    update(data: SensorData): void {
        const next = new Map<string, SensorStatus>();
        for (const [chipName, chip] of Object.entries(data)) {
            for (const category of sensorCategories) {
                for (const [label, values] of Object.entries(extractSensorGroup(chip, category.key))) {
                    const key = sensorKey(chipName, label);
                    next.set(key, sensorStatus(category.key, values, this.statuses.get(key)));
                }
            }
        }
        this.statuses = next;
    }

    get(chipName: string, label: string, categoryKey: string, values: SensorValueGroup): SensorStatus {
        return this.statuses.get(sensorKey(chipName, label)) ?? sensorStatus(categoryKey, values);
    }
}
