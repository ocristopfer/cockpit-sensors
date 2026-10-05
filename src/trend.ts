/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Recent readings of every sensor, kept in memory while the page is open,
 * for the sparklines and the minimum/maximum seen in this session.
 */

import { extractSensorGroup, getReading, sensorCategories } from "./sensors";
import type { SensorData } from "./sensors";

export const TREND_SAMPLES = 60;

export type Trend = { values: number[]; min: number; max: number };

export const sensorKey = (chipName: string, label: string): string => `${chipName}/${label}`;

export class TrendRecorder {
    private trends = new Map<string, Trend>();

    record(data: SensorData): void {
        for (const [chipName, chip] of Object.entries(data)) {
            for (const category of sensorCategories) {
                for (const [label, values] of Object.entries(extractSensorGroup(chip, category.key))) {
                    const reading = getReading(values);
                    if (typeof reading !== "number")
                        continue;
                    const key = sensorKey(chipName, label);
                    const trend = this.trends.get(key);
                    if (!trend) {
                        this.trends.set(key, { values: [reading], min: reading, max: reading });
                        continue;
                    }
                    trend.values.push(reading);
                    if (trend.values.length > TREND_SAMPLES)
                        trend.values.shift();
                    trend.min = Math.min(trend.min, reading);
                    trend.max = Math.max(trend.max, reading);
                }
            }
        }
    }

    get(key: string): Trend | undefined {
        return this.trends.get(key);
    }

    clear(): void {
        this.trends.clear();
    }
}
