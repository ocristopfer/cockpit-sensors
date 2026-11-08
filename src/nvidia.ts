/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * NVIDIA GPUs on the proprietary driver: that driver exports no hwmon
 * sensors, so lm-sensors does not see these cards. Read them with nvidia-smi
 * instead and present each card as one more chip.
 */

import cockpit from "cockpit";

import type { SensorChipGroup, SensorData } from "./sensors";

// the fields we ask nvidia-smi for, in the order of its CSV columns
const FIELDS = ["index", "pci.bus_id", "name", "temperature.gpu", "fan.speed", "power.draw", "power.limit"];

export const NVIDIA_SMI_COMMAND = ["nvidia-smi", `--query-gpu=${FIELDS.join(",")}`, "--format=csv,noheader,nounits"];

// chip names of these GPUs start with this, e.g. "nvidia-pci-0200"
export const NVIDIA_CHIP_PREFIX = "nvidia-";

export const isNvidiaChip = (chipName: string): boolean => chipName.startsWith(NVIDIA_CHIP_PREFIX);

/*
 * Chip name of a GPU from its PCI address, as lm-sensors names PCI chips
 * ("amdgpu-pci-0300"): the bus number and the device/function byte in hex.
 * nvidia-smi reports "00000000:02:00.0", i.e. domain:bus:device.function.
 */
const chipName = (busId: string, index: string): string => {
    const match = /^(?:[0-9a-f]+:)?([0-9a-f]{2}):([0-9a-f]{2})\.([0-7])$/i.exec(busId.trim());
    if (!match)
        return `${NVIDIA_CHIP_PREFIX}gpu-${index}`;
    const devfn = (parseInt(match[2], 16) << 3) | parseInt(match[3], 10);
    return `${NVIDIA_CHIP_PREFIX}pci-${match[1].toLowerCase()}${devfn.toString(16).padStart(2, "0")}`;
};

// a number, or undefined for "[N/A]", "[Not Supported]" and the like
const number = (field: string | undefined): number | undefined => {
    const value = parseFloat(field ?? "");
    return Number.isFinite(value) ? value : undefined;
};

// parse the output of NVIDIA_SMI_COMMAND into chips like those of `sensors -j`
export const parseNvidiaSmi = (output: string): SensorData => {
    const data: SensorData = Object.create(null);

    for (const line of output.split("\n")) {
        if (!line.trim())
            continue;
        const [index, busId, name, temp, fan, power, powerLimit] = line.split(",").map(field => field.trim());
        const chip: SensorChipGroup = Object.create(null);
        chip.Adapter = name || "NVIDIA GPU";
        // the card's NVML index, which also numbers its instances in PCP ("gpu0")
        if (/^\d+$/.test(index ?? ""))
            chip.Index = index;

        const temperature = number(temp);
        if (temperature !== undefined)
            chip.GPU = { temp1_input: temperature };
        const fanDuty = number(fan);
        if (fanDuty !== undefined)
            chip.Fan = { pwm1_input: fanDuty };
        const powerDraw = number(power);
        if (powerDraw !== undefined) {
            const cap = number(powerLimit);
            chip.Power = cap === undefined ? { power1_input: powerDraw } : { power1_input: powerDraw, power1_cap: cap };
        }

        data[chipName(busId ?? "", index ?? "")] = chip;
    }

    return data;
};

/*
 * Read the NVIDIA GPUs; resolves to {} when nvidia-smi is missing or fails
 * (no NVIDIA driver, no GPU), and to null when nvidia-smi is not installed,
 * so that the caller can stop asking.
 */
export const readNvidiaGpus = async (): Promise<SensorData | null> => {
    try {
        return parseNvidiaSmi(await cockpit.spawn(NVIDIA_SMI_COMMAND, { err: "message" }));
    } catch (err) {
        const { problem, message } = err as { problem?: string, message?: string };
        return problem === "not-found" || message === "not-found" ? null : {};
    }
};
