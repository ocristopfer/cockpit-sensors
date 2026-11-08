// Unit tests for the pure functions of src/; run with `npm run test:unit`

import { historyCsv } from "../../src/csv";
import { historyMetric, lineSegments, metricsDecoder, pcpMetricName, pcpPackages, rowHistoryStatus } from "../../src/history";
import { parseNvidiaSmi } from "../../src/nvidia";
import {
    chipDisplayName, chipDisplayNames, extractSensorGroup, formatReasons, formatSensorValue, getOsIds, getReading,
    parseSensorsRaw, sensorStatus, worstLevel
} from "../../src/sensors";
import type { SensorChipGroup } from "../../src/sensors";
import { StatusTracker } from "../../src/status";
import { TREND_SAMPLES, TrendRecorder } from "../../src/trend";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const QUnit: any;

const nct6798: SensorChipGroup = {
    Adapter: "ISA adapter",
    in0: { in0_input: 0.904, in0_min: 0, in0_max: 1.744, in0_alarm: 0, in0_beep: 0 },
    fan1: { fan1_input: 1150, fan1_min: 300, fan1_alarm: 0, fan1_pulses: 2 },
    SYSTIN: { temp1_input: 34, temp1_max: 80, temp1_max_hyst: 75, temp1_type: 4, temp1_offset: 0 },
    intrusion0: { intrusion0_alarm: 1, intrusion0_beep: 0 },
    beep_enable: { beep_enable: 0 } as unknown as SensorChipGroup[string],
};

QUnit.module("sensors", () => {
    QUnit.test("extractSensorGroup", assert => {
        assert.deepEqual(Object.keys(extractSensorGroup(nct6798, "in")), ["in0"], "in does not match intrusion");
        assert.deepEqual(Object.keys(extractSensorGroup(nct6798, "intrusion")), ["intrusion0"]);
        assert.deepEqual(extractSensorGroup(nct6798, "fan").fan1.fan1_input, 1150);
        assert.deepEqual(extractSensorGroup(nct6798, "power"), {});
    });

    QUnit.test("parseSensorsRaw", assert => {
        const output = [
            "coretemp-isa-0000",
            "Adapter: ISA adapter",
            "Package id 0:",
            "  temp1_input: 45.000",
            "  temp1_max: 80.000",
            "Core 0:",
            "  temp2_input: 43.000",
            "",
            "amdgpu-pci-0300",
            "Adapter: PCI adapter",
            "PPT:",
            "  power1_average: 18.000",
            "  power1_cap: 186.000",
            "",
        ].join("\n");
        assert.deepEqual(parseSensorsRaw(output), {
            "coretemp-isa-0000": {
                Adapter: "ISA adapter",
                "Package id 0": { temp1_input: 45, temp1_max: 80 },
                "Core 0": { temp2_input: 43 },
            },
            "amdgpu-pci-0300": {
                Adapter: "PCI adapter",
                PPT: { power1_average: 18, power1_cap: 186 },
            },
        });
    });

    QUnit.test("parseSensorsRaw does not pollute Object.prototype", assert => {
        const data = parseSensorsRaw(["__proto__", "__proto__:", "  polluted: 1", ""].join("\n"));
        assert.equal(({} as Record<string, unknown>).polluted, undefined);
        assert.deepEqual(Object.keys(data), ["__proto__"]);
        assert.deepEqual(Object.keys(data.__proto__.__proto__ as object), ["polluted"]);
    });

    QUnit.test("formatSensorValue", assert => {
        assert.equal(formatSensorValue("temp", "input", 50, false), "50.0 °C");
        assert.equal(formatSensorValue("temp", "input", 50, true), "122.0 °F");
        assert.equal(formatSensorValue("temp", "offset", 10, true), "18.0 °F", "offsets are differences");
        assert.equal(formatSensorValue("fan", "input", 1150.4, false), "1150 RPM");
        assert.equal(formatSensorValue("fan", "pulses", 2, false), "2");
        assert.equal(formatSensorValue("in", "input", 1.2, false), "1.20 V");
        assert.equal(formatSensorValue("power", "average", 18, false), "18.00 W");
        assert.equal(formatSensorValue("curr", "input", 0.5, false), "0.50 A");
        assert.equal(formatSensorValue("humidity", "input", 40, false), "40.0 %");
        assert.equal(formatSensorValue("temp", "crit_alarm", 1, false), "1");
    });

    QUnit.test("getReading", assert => {
        assert.equal(getReading({ temp1_input: 40, temp1_max: 80 }), 40);
        assert.equal(getReading({ power1_average: 18, power1_cap: 186 }), 18);
        assert.equal(getReading({ intrusion0_alarm: 0 }), undefined);
    });

    QUnit.test("sensorStatus", assert => {
        const level = (category: string, values: Record<string, number>) => sensorStatus(category, values).level;

        assert.equal(level("temp", { temp1_input: 50, temp1_max: 80, temp1_crit: 100 }), "ok");
        assert.equal(level("temp", { temp1_input: 85, temp1_max: 80, temp1_crit: 100 }), "warning");
        assert.equal(level("temp", { temp1_input: 100, temp1_max: 80, temp1_crit: 100 }), "critical");
        assert.equal(level("temp", { temp1_input: 106, temp1_crit: 110, temp1_emergency: 105 }), "critical");
        assert.equal(level("temp", { temp1_input: 50, temp1_max: 0 }), "ok", "a limit of 0 is not set");
        assert.equal(level("temp", { temp1_input: 40, temp1_crit_alarm: 1 }), "critical");
        assert.equal(level("temp", { temp1_input: 40, temp1_alarm: 1 }), "warning", "plain alarms are warnings");
        assert.equal(level("temp", { temp1_input: 40, temp1_fault: 1 }), "warning");

        assert.equal(level("fan", { fan1_input: 1000, fan1_min: 300 }), "ok");
        assert.equal(level("fan", { fan1_input: 200, fan1_min: 300 }), "warning");
        assert.equal(level("fan", { fan1_input: 0, fan1_min: 300 }), "critical");
        assert.equal(level("fan", { fan1_input: 0, fan1_min: 0 }), "ok", "zero-RPM fan without a minimum");

        assert.equal(level("in", { in1_input: 1.0, in1_min: 1.1, in1_max: 1.3 }), "warning");
        assert.equal(level("in", { in1_input: 1.2, in1_min: 1.1, in1_max: 1.3 }), "ok");
        assert.equal(level("in", { in1_input: 1.0, in1_min: 1.1, in1_max: 0.5 }), "ok", "limits with min > max are ignored");
        assert.equal(level("in", { in0_input: 4.9, in0_min: 5.0, in0_max: 5.0 }), "ok", "limits with min == max are ignored");
        assert.equal(level("in", { in1_input: 0.5, in1_lcrit: 0.6 }), "critical");
        assert.equal(level("in", { in7_input: 0, in7_alarm: 1 }), "warning", "alarm of an unconnected input");

        assert.equal(level("intrusion", { intrusion0_alarm: 1 }), "warning", "often latched on boards without a switch");
        assert.equal(level("intrusion", { intrusion0_alarm: 0 }), "ok");
    });

    QUnit.test("sensorStatus reasons", assert => {
        const reasons = (category: string, values: Record<string, number>, fahrenheit = false) =>
            formatReasons(category, sensorStatus(category, values), fahrenheit);

        assert.equal(reasons("temp", { temp1_input: 85, temp1_max: 80, temp1_alarm: 1 }), "Above the maximum (80.0 °C)",
                     "an alarm explained by a limit adds nothing");
        assert.equal(reasons("temp", { temp1_input: 85, temp1_max: 80 }, true), "Above the maximum (176.0 °F)");
        assert.equal(reasons("temp", { temp1_input: 101, temp1_crit: 100, temp1_crit_alarm: 1 }), "Above the critical limit (100.0 °C)");
        assert.equal(reasons("temp", { temp1_input: 50, temp1_crit_alarm: 1 }), "Critical alarm reported by the chip");
        assert.equal(reasons("fan", { fan2_input: 0, fan2_min: 300, fan2_alarm: 1 }), "Fan stopped");
        assert.equal(reasons("fan", { fan1_input: 200, fan1_min: 300 }), "Below the minimum (300 RPM)");
        assert.equal(reasons("in", { in1_input: 1.0, in1_min: 1.1 }), "Below the minimum (1.10 V)");
        assert.equal(reasons("intrusion", { intrusion0_alarm: 1 }), "Chassis was opened");
        assert.equal(reasons("in", { in7_input: 0, in7_alarm: 1 }), "Alarm reported by the chip");
    });

    QUnit.test("sensorStatus hysteresis", assert => {
        const values = (input: number) => ({ temp1_input: input, temp1_max: 80, temp1_max_hyst: 75 });
        const above = sensorStatus("temp", values(81));
        assert.equal(above.level, "warning");
        assert.equal(sensorStatus("temp", values(78), above).level, "warning", "stays above max until below max_hyst");
        assert.equal(sensorStatus("temp", values(74), above).level, "ok");
        assert.equal(sensorStatus("temp", values(78)).level, "ok", "no hysteresis when it was fine before");
        assert.equal(sensorStatus("temp", { temp1_input: 78, temp1_max: 80 }, above).level, "ok", "no hysteresis without max_hyst");

        const statuses = new StatusTracker();
        statuses.update({ chip: { CPU: values(81) } });
        statuses.update({ chip: { CPU: values(78) } });
        assert.equal(statuses.get("chip", "CPU", "temp", values(78)).level, "warning", "StatusTracker keeps the previous status");
        statuses.update({ chip: { CPU: values(70) } });
        assert.equal(statuses.get("chip", "CPU", "temp", values(70)).level, "ok");
    });

    QUnit.test("worstLevel", assert => {
        assert.equal(worstLevel(["ok", "critical", "warning"]), "critical");
        assert.equal(worstLevel([]), "ok");
    });

    QUnit.test("parseNvidiaSmi", assert => {
        // real output of a GTX 1060 on the proprietary driver
        const gtx1060 = "0, 00000000:02:00.0, NVIDIA GeForce GTX 1060 3GB, 69, 38, 83.51, 120.00\n";
        const data = parseNvidiaSmi(gtx1060);
        assert.deepEqual(Object.keys(data), ["nvidia-pci-0200"]);
        const chip = data["nvidia-pci-0200"];
        assert.equal(chip.Adapter, "NVIDIA GeForce GTX 1060 3GB");
        assert.deepEqual(extractSensorGroup(chip, "temp"), { GPU: { temp1_input: 69 } });
        assert.deepEqual(extractSensorGroup(chip, "pwm"), { Fan: { pwm1_input: 38 } });
        assert.deepEqual(extractSensorGroup(chip, "power"), { Power: { power1_input: 83.51, power1_cap: 120 } });
        assert.equal(chipDisplayName("nvidia-pci-0200"), "GPU");
        assert.equal(formatSensorValue("pwm", "input", 38, false), "38 %");

        // fanless cards and missing readings report [N/A] or [Not Supported]
        const two = parseNvidiaSmi([
            "0, 00000000:01:00.0, NVIDIA A100, 41, [N/A], 55.10, [Not Supported]",
            "1, 0000:81:1f.3, NVIDIA A100, [N/A], [N/A], [N/A], [N/A]",
            "",
        ].join("\n"));
        assert.deepEqual(Object.keys(two), ["nvidia-pci-0100", "nvidia-pci-81fb"], "device 1f, function 3 is devfn fb");
        assert.deepEqual(Object.keys(two["nvidia-pci-0100"]), ["Adapter", "Index", "GPU", "Power"]);
        assert.deepEqual(two["nvidia-pci-0100"].Power, { power1_input: 55.1 }, "no cap when the limit is unknown");
        assert.deepEqual(Object.keys(two["nvidia-pci-81fb"]), ["Adapter", "Index"]);
        assert.equal(two["nvidia-pci-81fb"].Index, "1", "the NVML index numbers the PCP instances");
        assert.deepEqual(Object.keys(parseNvidiaSmi("0, unknown, X, 50, 0, 0, 0")), ["nvidia-gpu-0"]);
        assert.deepEqual(parseNvidiaSmi(""), {});
    });

    QUnit.test("chipDisplayName", assert => {
        assert.equal(chipDisplayName("coretemp-isa-0000"), "CPU (Intel)");
        assert.equal(chipDisplayName("k10temp-pci-00c3"), "CPU (AMD)");
        assert.equal(chipDisplayName("nct6798-isa-0290"), "Motherboard");
        assert.equal(chipDisplayName("it8689-isa-0a40"), "Motherboard");
        assert.equal(chipDisplayName("amdgpu-pci-0300"), "GPU");
        assert.equal(chipDisplayName("ucsi_source_psy_USBC000:001-isa-0000"), "Power supply");
        assert.equal(chipDisplayName("mystery-virtual-0"), "mystery-virtual-0");
        assert.deepEqual(chipDisplayNames(["nvme-pci-0100", "coretemp-isa-0000", "nvme-pci-0200"]), {
            "nvme-pci-0100": "NVMe drive 1",
            "coretemp-isa-0000": "CPU (Intel)",
            "nvme-pci-0200": "NVMe drive 2",
        });
    });

    QUnit.test("getOsIds", assert => {
        assert.deepEqual(getOsIds('NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n'), ["ubuntu", "debian"]);
        assert.deepEqual(getOsIds('ID="rocky"\nID_LIKE="rhel centos fedora"\n'), ["rocky", "rhel", "centos", "fedora"]);
        assert.deepEqual(getOsIds("ID=arch\n"), ["arch"]);
    });
});

QUnit.module("history", () => {
    QUnit.test("pcpMetricName", assert => {
        assert.equal(pcpMetricName("coretemp-isa-0000", "Package id 0"), "lmsensors.coretemp_isa_0000.package_id_0");
        assert.equal(pcpMetricName("coretemp-isa-0000", "Core 1"), "lmsensors.coretemp_isa_0000.core_1");
        assert.equal(pcpMetricName("nct6798-isa-0290", "in0"), "lmsensors.nct6798_isa_0290.in0");
        assert.equal(pcpMetricName("acpitz-acpi-0", "temp1"), "lmsensors.acpitz_acpi_0.temp1");
        assert.equal(pcpMetricName("x-isa-0", "Vcore 1.2"), "lmsensors.x_isa_0.vcore_1,2");
    });

    QUnit.test("lineSegments", assert => {
        const min = 60 * 1000;
        // values every `step` minutes, null at the given indexes
        const series = (step: number, count: number, missing: number[]) =>
            Array.from({ length: count }, (_, i) => ({ t: i * step * min, v: missing.includes(i) ? null : i }));
        const lengths = (step: number, count: number, missing: number[]) =>
            lineSegments(series(step, count, missing)).map(s => s.length);

        assert.deepEqual(lengths(5, 6, []), [6]);
        assert.deepEqual(lengths(5, 6, [2, 3]), [4], "24h: a 15-minute gap at an archive boundary is drawn across");
        assert.deepEqual(lengths(30, 6, [2]), [5], "7d: a single missing sample is drawn across");
        assert.deepEqual(lengths(5, 8, [2, 3, 4]), [2, 3], "a 20-minute gap splits the line");
        assert.deepEqual(lengths(30, 6, [2, 3]), [2, 2], "7d: two missing samples split the line");
        assert.deepEqual(lengths(5, 6, [0, 1, 5]), [3], "missing samples at the ends are dropped");
        assert.deepEqual(lineSegments([{ t: 0, v: null }]), []);
    });

    QUnit.test("historyMetric", assert => {
        assert.deepEqual(historyMetric("coretemp-isa-0000", { "Core 0": { temp1_input: 1 } }, "Core 0", "temp"),
                         { id: "lmsensors.coretemp_isa_0000.core_0", name: "lmsensors.coretemp_isa_0000.core_0" });
        assert.equal(historyMetric("nct6798-isa-0290", { intrusion0: { intrusion0_alarm: 0 } }, "intrusion0", "intrusion"), null,
                     "pmdalmsensors exports only sensors with an input");

        // NVIDIA GPUs: recorded by pmdanvidia, one instance per card, power in milliwatts
        const gpu = parseNvidiaSmi("0, 00000000:02:00.0, NVIDIA GeForce GTX 1060 3GB, 69, 38, 83.51, 120.00")["nvidia-pci-0200"];
        assert.deepEqual(historyMetric("nvidia-pci-0200", gpu, "GPU", "temp"),
                         { id: "nvidia.temperature.gpu0", name: "nvidia.temperature", instance: "gpu0", scale: undefined });
        assert.deepEqual(historyMetric("nvidia-pci-0200", gpu, "Fan", "pwm"),
                         { id: "nvidia.fanspeed.gpu0", name: "nvidia.fanspeed", instance: "gpu0", scale: undefined });
        assert.deepEqual(historyMetric("nvidia-pci-0200", gpu, "Power", "power"),
                         { id: "nvidia.power.gpu0", name: "nvidia.power", instance: "gpu0", scale: 0.001 });
        assert.equal(historyMetric("nvidia-pci-0200", { GPU: { temp1_input: 69 } }, "GPU", "temp"), null,
                     "no instance without the card's index");
    });

    QUnit.test("metricsDecoder", assert => {
        // real messages of the metrics1 channel reading nvidia.temperature from a pmlogger archive:
        // before the archive starts there are no instances, then gpu0
        const messages = [
            { timestamp: 1000, interval: 60000, metrics: [{ name: "nvidia.temperature", instances: [] }] },
            [[[]]],
            { timestamp: 61000, interval: 60000, metrics: [{ name: "nvidia.temperature", instances: ["gpu0"] }] },
            [[[67.0]], [[68.0]], [[]], [null], [[false]]],
        ];
        const temperature = metricsDecoder({ id: "t", name: "nvidia.temperature", instance: "gpu0" }, 60000);
        messages.forEach(temperature.decode);
        assert.deepEqual(temperature.samples.map(s => s.v), [null, 67, 68, 68, 68, null], "shorter arrays and null mean unchanged");
        assert.deepEqual(temperature.samples.map(s => s.t), [1000, 61000, 121000, 181000, 241000, 301000]);

        const power = metricsDecoder({ id: "p", name: "nvidia.power", instance: "gpu1", scale: 0.001 }, 60000);
        power.decode({ timestamp: 0, interval: 60000, metrics: [{ name: "nvidia.power", instances: ["gpu0", "gpu1"] }] });
        power.decode([[[50000, 83510]], [[null, 62480]]]);
        assert.deepEqual(power.samples.map(s => s.v === null ? null : Math.round(s.v * 1000) / 1000), [83.51, 62.48],
                         "the requested instance, in watts");

        const other = metricsDecoder({ id: "o", name: "nvidia.power", instance: "gpu3" }, 60000);
        other.decode({ timestamp: 0, interval: 60000, metrics: [{ name: "nvidia.power", instances: ["gpu0"] }] });
        other.decode([[[50000]]]);
        assert.deepEqual(other.samples.map(s => s.v), [null], "no value for an instance the archive lacks");

        const plain = metricsDecoder({ id: "l", name: "lmsensors.coretemp_isa_0000.core_0" }, 60000);
        plain.decode({ timestamp: 0, interval: 60000, metrics: [{ name: "lmsensors.coretemp_isa_0000.core_0" }] });
        plain.decode([[45], [null], [], [false], [47]]);
        assert.deepEqual(plain.samples.map(s => s.v), [45, 45, 45, null, 47]);
    });

    QUnit.test("rowHistoryStatus", assert => {
        assert.equal(rowHistoryStatus("coretemp-isa-0000", "no-gpu-logger"), "enabled", "lm-sensors history works");
        assert.equal(rowHistoryStatus("nvidia-pci-0200", "no-gpu-logger"), "no-gpu-logger");
        assert.equal(rowHistoryStatus("nvidia-pci-0200", "enabled"), "enabled");
        assert.equal(rowHistoryStatus("coretemp-isa-0000", "no-pmda"), "no-pmda");
    });

    QUnit.test("pcpPackages", assert => {
        assert.deepEqual(pcpPackages(["ubuntu", "debian"], true), ["pcp", "python3-pcp", "cockpit-pcp"]);
        assert.deepEqual(pcpPackages(["rocky", "rhel"], true), ["pcp", "python3-pcp", "pcp-pmda-lmsensors", "cockpit-pcp"]);
        // Cockpit 326 dropped cockpit-pcp
        assert.deepEqual(pcpPackages(["fedora"], false), ["pcp", "python3-pcp", "pcp-pmda-lmsensors"]);
        assert.deepEqual(pcpPackages(["ubuntu", "debian"], false), ["pcp", "python3-pcp"]);
        assert.equal(pcpPackages(["arch"], true), null);
        // the NVIDIA PMDA: its own package outside Debian and Ubuntu
        assert.deepEqual(pcpPackages(["fedora"], false, true), ["pcp", "python3-pcp", "pcp-pmda-lmsensors", "pcp-pmda-nvidia-gpu"]);
        assert.deepEqual(pcpPackages(["debian"], false, true), ["pcp", "python3-pcp"]);
    });

    QUnit.test("historyCsv", assert => {
        const t = Date.UTC(2026, 0, 1, 12, 0, 0);
        assert.equal(
            historyCsv("Core 0", [{ t, v: 41.5 }, { t: t + 60000, v: null }], "°C"),
            "time,Core 0 (°C)\n2026-01-01T12:00:00.000Z,41.5\n2026-01-01T12:01:00.000Z,\n"
        );
        assert.equal(historyCsv('a, "b"', [], ""), 'time,"a, ""b"""\n');
    });
});

QUnit.module("trend", () => {
    QUnit.test("TrendRecorder", assert => {
        const trends = new TrendRecorder();
        for (let i = 0; i < TREND_SAMPLES + 10; i++)
            trends.record({ chip: { Core: { temp1_input: i } } });
        const trend = trends.get("chip/Core");
        assert.equal(trend?.values.length, TREND_SAMPLES, "keeps the last samples only");
        assert.equal(trend?.values[TREND_SAMPLES - 1], TREND_SAMPLES + 9);
        assert.equal(trend?.min, 0, "minimum of the whole session");
        assert.equal(trend?.max, TREND_SAMPLES + 9);
        assert.equal(trends.get("chip/Other"), undefined);
    });
});
