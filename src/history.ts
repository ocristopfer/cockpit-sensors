/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Sensor history through Performance Co-Pilot (PCP): the lm-sensors PMDA
 * (pmdalmsensors) exports every sensor's current value as
 * lmsensors.<chip>.<label>, pmlogger records it, and Cockpit's "metrics1"
 * channel reads it back from the pmlogger archives.
 */

import cockpit from "cockpit";

import { isNvidiaChip } from "./nvidia";
import type { SensorChipGroup } from "./sensors";

export type HistoryStatus =
    | "loading"
    | "no-pcp" // PCP is not installed
    | "no-pmda" // the lm-sensors PMDA is not installed or exports no metrics
    | "no-logger" // pmlogger does not record lmsensors, or is not running
    | "no-python" // python3-pcp is missing, Cockpit cannot read archives
    | "no-cockpit-pcp" // Cockpit < 326 without cockpit-pcp has no channel to read archives
    | "no-gpu-logger" // the lm-sensors history works, but pmlogger does not record the NVIDIA GPUs
    | "enabled";

export type HistorySample = { t: number; v: number | null };

export type HistoryRange = {
    id: string;
    durationMs: number;
    points: number;
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const historyRanges: HistoryRange[] = [
    { id: "1h", durationMs: HOUR, points: 60 },
    { id: "24h", durationMs: 24 * HOUR, points: 288 },
    { id: "7d", durationMs: 7 * 24 * HOUR, points: 336 },
];

// how often pmlogger records the sensors (see PMLOGCONF_GROUP)
export const LOG_INTERVAL_MS = MINUTE;

// longest run of missing samples that the chart draws across
const MAX_BRIDGED_GAP_MS = 15 * MINUTE;

/*
 * Split samples into the runs of values that the chart draws as one line.
 * PCP cannot interpolate across the end of one pmlogger archive and the start
 * of the next, such as when pmlogger_daily restarts pmlogger every night, so
 * a sample or two there has no value. Draw across such short gaps (a single
 * missing sample, or up to MAX_BRIDGED_GAP_MS) and split the line at longer
 * ones, when nothing was recorded.
 */
export const lineSegments = (samples: HistorySample[]): HistorySample[][] => {
    const segments: HistorySample[][] = [];
    let segment: HistorySample[] = [];
    let missing = 0;

    for (const sample of samples) {
        if (sample.v === null) {
            missing++;
            continue;
        }
        const last = segment[segment.length - 1];
        if (last && missing > 1 && sample.t - last.t > MAX_BRIDGED_GAP_MS) {
            segments.push(segment);
            segment = [];
        }
        segment.push(sample);
        missing = 0;
    }
    if (segment.length > 0)
        segments.push(segment);

    return segments;
};

/*
 * Name of the PCP metric for a sensor, mirroring how pmdalmsensors builds it:
 * it strips a digit before "_" in the raw JSON, replaces "." in labels by ",",
 * lowercases, and replaces spaces and dashes by "_".
 */
export const pcpMetricName = (chip: string, label: string): string => {
    const clean = (s: string) => s.replace(/\d_/g, "_").toLowerCase()
            .replace(/ /g, "_")
            .replace(/-/g, "_");
    return `lmsensors.${clean(chip)}.${clean(label.replace(/\./g, ","))}`;
};

/*
 * A recorded series: the PCP metric, its instance for instanced metrics, and
 * the factor from its unit to the unit the sensor is shown in. The id names
 * it in the UI (expanded rows, CSV file names).
 */
export type HistoryMetric = { id: string; name: string; instance?: string | undefined };

/*
 * The NVIDIA GPUs are recorded from nvidia-smi too, by a script that PCP's
 * OpenMetrics agent (pmdaopenmetrics) runs: PCP's NVIDIA agent cannot read
 * the fan of some cards (nvidia.fanspeed is "not supported" on a GTX 1060
 * whose fan nvidia-smi reads). One instance per card, named after its
 * nvidia-smi index ("gpu0"); the agent names it "0 instname:gpu0".
 */
const NVIDIA_SOURCE = "cockpit_sensors_nvidia";
const NVIDIA_METRICS: Record<string, string> = {
    temp: "temperature",
    pwm: "fanspeed",
    power: "power",
};

// the script for pmdaopenmetrics: the readings of each GPU in OpenMetrics text format
export const NVIDIA_OPENMETRICS_SCRIPT = String.raw`#!/bin/sh
# NVIDIA GPU readings for Cockpit Sensors, recorded by PCP through pmdaopenmetrics
nvidia-smi --query-gpu=index,temperature.gpu,fan.speed,power.draw --format=csv,noheader,nounits 2>/dev/null |
awk -F', *' '
    { n++; gpu[n] = $1; v["temperature", n] = $2; v["fanspeed", n] = $3; v["power", n] = $4 }
    END {
        split("temperature fanspeed power", names, " ")
        for (m = 1; m <= 3; m++) {
            print "# TYPE " names[m] " gauge"
            for (i = 1; i <= n; i++)
                if (v[names[m], i] ~ /^[0-9]+(\.[0-9]+)?$/)
                    printf "%s{instname=\"gpu%s\"} %s\n", names[m], gpu[i], v[names[m], i]
        }
    }'
`;

/*
 * The recorded series of a sensor row, or null when it has none: the lm-sensors
 * sensors with an *_input sub-feature, which pmdalmsensors exports, and the
 * temperature, fan and power of the NVIDIA GPUs.
 */
export const historyMetric = (chipName: string, chip: SensorChipGroup, label: string, categoryKey: string): HistoryMetric | null => {
    if (isNvidiaChip(chipName)) {
        const metric = NVIDIA_METRICS[categoryKey];
        if (!metric || typeof chip.Index !== "string")
            return null;
        const name = `openmetrics.${NVIDIA_SOURCE}.${metric}`;
        const instance = `gpu${chip.Index}`;
        return { id: `${name}.${instance}`, name, instance };
    }
    const values = chip[label];
    if (typeof values !== "object" || !Object.keys(values).some(key => key.includes("_input")))
        return null;
    const name = pcpMetricName(chipName, label);
    return { id: name, name };
};

// the history status of one row: GPUs may not be recorded while the lm-sensors history works
export const rowHistoryStatus = (chipName: string, status: HistoryStatus): HistoryStatus =>
    status === "no-gpu-logger" && !isNvidiaChip(chipName) ? "enabled" : status;

/*
 * Cockpit reads PCP archives with its Python bridge since version 326, which
 * dropped the cockpit-pcp package; older versions need cockpit-pcp for it.
 */
const COCKPIT_PCP_DROPPED = 326;
const NEEDS_COCKPIT_PCP = String.raw`
needs_cockpit_pcp() {
    v=$(cockpit-bridge --version 2>/dev/null | sed -n 's/^Version: *\([0-9][0-9]*\).*/\1/p')
    [ -n "$v" ] && [ "$v" -lt ${COCKPIT_PCP_DROPPED} ]
}
`;

const STATUS_SCRIPT = `${NEEDS_COCKPIT_PCP}
if ! command -v pminfo >/dev/null 2>&1; then echo no-pcp; exit 0; fi
. /etc/pcp.env
pminfo lmsensors >/dev/null 2>&1 || { echo no-pmda; exit 0; }
grep -q '^#+ cockpit-sensors/lmsensors:y' "$PCP_VAR_DIR/config/pmlogger/config.default" 2>/dev/null || { echo no-logger; exit 0; }
systemctl is-active -q pmlogger || { echo no-logger; exit 0; }
python3 -c 'import pcp' 2>/dev/null || { echo no-python; exit 0; }
if needs_cockpit_pcp && [ ! -e /usr/share/cockpit/pcp/manifest.json ] && [ ! -e /usr/local/share/cockpit/pcp/manifest.json ]; then
    echo no-cockpit-pcp; exit 0
fi
# NVIDIA GPUs (see ENABLE_SCRIPT): history set up before they were supported records only lm-sensors
if command -v nvidia-smi >/dev/null 2>&1; then
    if [ ! -x "$PCP_PMDAS_DIR/openmetrics/config.d/${NVIDIA_SOURCE}.sh" ] ||
            ! grep -q '^#+ cockpit-sensors/nvidia:y' "$PCP_VAR_DIR/config/pmlogger/config.default" 2>/dev/null; then
        echo no-gpu-logger; exit 0
    fi
fi
echo enabled
`;

export const getHistoryStatus = async (): Promise<HistoryStatus> => {
    const out = await cockpit.script(STATUS_SCRIPT, { err: "message" });
    return out.trim() as HistoryStatus;
};

export const needsCockpitPcp = async (): Promise<boolean> => {
    const out = await cockpit.script(`${NEEDS_COCKPIT_PCP}
needs_cockpit_pcp && echo yes || echo no`, { err: "message" });
    return out.trim() === "yes";
};

const distroPcpPackages = (osIds: string[], nvidia: boolean): string[] | null => {
    for (const osId of osIds) {
        switch (osId) {
        case "fedora":
        case "rhel":
        case "centos":
        case "suse":
        case "opensuse":
            return ["pcp", "python3-pcp", "pcp-pmda-lmsensors", ...nvidia ? ["pcp-pmda-openmetrics"] : []];
        case "debian":
        case "ubuntu":
            // the lm-sensors and OpenMetrics PMDAs are part of the pcp package
            return ["pcp", "python3-pcp"];
        }
    }
    return null;
};

// PCP packages per distribution, null when PCP is not packaged in the official repositories;
// on Cockpit < 326, cockpit-pcp lets Cockpit read the recorded archives; NVIDIA GPUs are recorded
// through the OpenMetrics PMDA
export const pcpPackages = (osIds: string[], cockpitPcp: boolean, nvidia = false): string[] | null => {
    const packages = distroPcpPackages(osIds, nvidia);
    return packages && cockpitPcp ? [...packages, "cockpit-pcp"] : packages;
};

const installCommand = (osIds: string[], packages: string[]): string[] => {
    if (osIds.includes("debian") || osIds.includes("ubuntu"))
        return ["apt-get", "install", "-y", ...packages];
    if (osIds.includes("suse") || osIds.includes("opensuse"))
        return ["zypper", "install", "-y", ...packages];
    return ["dnf", "install", "-y", ...packages];
};

/*
 * Installs PCP, registers the lm-sensors PMDA and makes pmlogger record it
 * through a pmlogconf group, so that pmlogconf keeps it on config updates.
 * With nvidia-smi, records the NVIDIA GPUs, which lm-sensors does not see, the
 * same way: through NVIDIA_OPENMETRICS_SCRIPT, which the OpenMetrics PMDA runs
 * and which comes in $NVIDIA_SCRIPT.
 * The install command is passed as arguments ("$@").
 */
const ENABLE_SCRIPT = `
set -e
"$@"
. /etc/pcp.env
systemctl enable --now pmcd

cd "$PCP_PMDAS_DIR/lmsensors"
./Install </dev/null

GROUP_DIR="$PCP_VAR_DIR/config/pmlogconf/cockpit-sensors"
mkdir -p "$GROUP_DIR"
printf '#pmlogconf-setup 2.0\\nident\\tlm-sensors readings (temperatures, fans, voltages) for Cockpit Sensors\\nforce\\tinclude\\ndelta\\t1 minute\\n\\tlmsensors\\n' > "$GROUP_DIR/lmsensors"
rm -f "$GROUP_DIR/nvidia"
if command -v nvidia-smi >/dev/null 2>&1; then
    OM="$PCP_PMDAS_DIR/openmetrics"
    [ -d "$OM" ] || { echo "the PCP OpenMetrics agent is not installed" >&2; exit 1; }
    printf '%s' "$NVIDIA_SCRIPT" > "$OM/config.d/${NVIDIA_SOURCE}.sh"
    chmod 755 "$OM/config.d/${NVIDIA_SOURCE}.sh"
    (cd "$OM" && ./Install </dev/null)
    printf '#pmlogconf-setup 2.0\\nident\\tNVIDIA GPU readings (temperature, fan, power) for Cockpit Sensors\\nforce\\tinclude\\ndelta\\t1 minute\\n\\topenmetrics.${NVIDIA_SOURCE}\\n' > "$GROUP_DIR/nvidia"
fi

systemctl enable --now pmlogger

CFG="$PCP_VAR_DIR/config/pmlogger/config.default"
i=0
while [ ! -f "$CFG" ] && [ $i -lt 60 ]; do sleep 1; i=$((i + 1)); done
[ -f "$CFG" ] || { echo "pmlogger did not create $CFG" >&2; exit 1; }

# (re-)add our group; pmlogconf keeps a group excluded once it saw it disabled
sed -i '/^#+ cockpit-sensors\\//,/^#----/d' "$CFG"
pmlogconf -q "$CFG" </dev/null >/dev/null
systemctl restart pmlogger
`;

export const enableHistory = async (osIds: string[], packages: string[] | null): Promise<void> => {
    if (!packages)
        throw new Error(cockpit.format(cockpit.gettext("PCP is not available for $0"), osIds[0] ?? "unknown"));

    await cockpit.script(ENABLE_SCRIPT, installCommand(osIds, packages), {
        err: "message",
        superuser: "require",
        environ: ["DEBIAN_FRONTEND=noninteractive", `NVIDIA_SCRIPT=${NVIDIA_OPENMETRICS_SCRIPT}`],
    });
};

/*
 * Cockpit's metrics channel reads every archive of a directory and gives up
 * when the metric is missing from any of them, which is the case for archives
 * written before sensor history was enabled (or before a sensor appeared).
 * So link the archives that cover the range and contain the metric into a
 * temporary directory, and read that one. Archive names carry their start time
 * in the server's local time zone, so all of this runs on the server.
 *
 * pmlogger writes YYYYMMDD.HH.MM archives (with a -NN suffix on name clashes),
 * and pmlogger_daily merges each day's archives into one YYYYMMDD archive
 * (YYYYMMDD-NN on clashes), often compressing its volumes. A merged archive
 * starts at some time during its day, so take the end of that day as its start:
 * this may link one archive too many, but never misses one.
 * Arguments: metric, range start (seconds since the epoch). Prints the
 * directory, or nothing when no archive has the metric.
 */
const PREPARE_ARCHIVES_SCRIPT = String.raw`
set -e
metric="$1"
start="$2"
. /etc/pcp.env
src="$PCP_LOG_DIR/pmlogger/$(uname -n)"
[ -d "$src" ] || exit 0
dir=$(mktemp -d -t cockpit-sensors-history.XXXXXX)

# link the files of one archive: .index, .meta and the data volumes .0, .1, …,
# possibly compressed; not those of another archive whose name starts the same
# (such as 20261105.00.10.* next to 20261105.*). libpcp cannot read a compressed
# volume through a symlink (PCP 7.1 reports "Corrupted record" for a .0.zst
# link), so copy compressed files; they are small, and pmlogger_daily only
# compresses archives it is done with, so link the others, among them the one
# pmlogger is writing.
add() {
    pminfo -a "$1" "$metric" >/dev/null 2>&1 || return 0
    for file in "$1".*; do
        name=$(echo "$file" | sed -n 's/\.\(index\|meta\|[0-9]\{1,3\}\)\(\.\(xz\|zst\|gz\|bz2\|lzma\)\)\{0,1\}$//p')
        [ "$name" = "$1" ] || continue
        case "$file" in
            *.xz|*.zst|*.gz|*.bz2|*.lzma) cp "$file" "$dir"/ ;;
            *) ln -s "$file" "$dir"/ ;;
        esac
    done
}

# "start-time archive" lines, sorted by start time
list=$(for f in "$src"/*.index; do
    [ -e "$f" ] || continue
    archive=$(echo "$f" | sed 's/\.index$//')
    base=$(basename "$archive")
    stamp=$(echo "$base" | sed -n 's/^\([0-9]\{4\}\)\([0-9]\{2\}\)\([0-9]\{2\}\)\.\([0-9]\{2\}\)\.\([0-9]\{2\}\)\(-[0-9]*\)\{0,1\}$/\1-\2-\3 \4:\5/p')
    if [ -n "$stamp" ]; then
        t=$(date -d "$stamp" +%s)
    else
        day=$(echo "$base" | sed -n 's/^\([0-9]\{4\}\)\([0-9]\{2\}\)\([0-9]\{2\}\)\(-[0-9]*\)\{0,1\}$/\1-\2-\3/p')
        [ -n "$day" ] || continue
        t=$(($(date -d "$day 00:00" +%s) + 86400))
    fi
    echo "$t $archive"
done | sort -n -k1,1)

prev=""
while read -r t archive; do
    [ -n "$archive" ] || continue
    # the previous archive ends where this one starts
    if [ -n "$prev" ] && [ "$t" -gt "$start" ]; then
        add "$prev"
    fi
    prev="$archive"
done <<EOF
$list
EOF
[ -z "$prev" ] || add "$prev"

if [ -z "$(ls -A "$dir")" ]; then
    rmdir "$dir"
else
    echo "$dir"
fi
`;

type MetricsValue = number | null | false;

/*
 * Decodes the messages of a "metrics1" channel reading one metric into
 * samples. Meta messages give the start time and interval of the following
 * data messages, and the instances they hold values for, which change when an
 * archive has other ones. Data messages are compressed: null (or a shorter
 * array) means "unchanged", false means "no value"; an instanced metric has an
 * array with one value per instance of the last meta message. An instance is
 * matched by the last word of its name: pmdaopenmetrics prefixes its own id and
 * the label name ("0 instname:gpu0").
 */
const instanceMatches = (name: unknown, instance: string): boolean =>
    typeof name === "string" && name.split(/[ :]/).pop() === instance;

export const metricsDecoder = (metric: HistoryMetric, interval: number) => {
    const samples: HistorySample[] = [];
    let timestamp = 0;
    let step = interval;
    let current: number | null = null;
    // position of the requested instance in the values of an instanced metric, -1 while absent
    let position = -1;

    const decode = (message: unknown) => {
        if (!Array.isArray(message)) {
            const meta = message as { timestamp: number; interval: number; metrics?: { instances?: unknown }[] };
            timestamp = meta.timestamp;
            step = meta.interval;
            const instances = meta.metrics?.[0]?.instances;
            const instance = metric.instance;
            position = instance && Array.isArray(instances) ? instances.findIndex(name => instanceMatches(name, instance)) : -1;
            return;
        }

        for (const sample of message as (MetricsValue | MetricsValue[])[][]) {
            let value = sample[0];
            if (metric.instance) {
                if (position < 0)
                    value = false;
                else if (Array.isArray(value))
                    value = value[position] ?? null;
            }
            if (typeof value === "number")
                current = value;
            else if (value === false)
                current = null;
            samples.push({ t: timestamp, v: current });
            timestamp += step;
        }
    };

    return { decode, samples };
};

/*
 * Read the recorded values of one metric for a range from the pmlogger archives.
 * Resolves to [] when nothing was recorded yet.
 */
export const loadHistory = async (metric: HistoryMetric, range: HistoryRange): Promise<HistorySample[]> => {
    const start = Date.now() - range.durationMs;
    const interval = Math.round(range.durationMs / range.points);

    const dir = (await cockpit.script(PREPARE_ARCHIVES_SCRIPT, [metric.name, String(Math.floor(start / 1000))],
                                      { err: "message" })).trim();
    if (!dir)
        return [];

    try {
        return await new Promise((resolve, reject) => {
            const { decode, samples } = metricsDecoder(metric, interval);

            // all instances: the channel's "instances" option filters out everything when reading archives
            const channel = cockpit.channel({
                payload: "metrics1",
                source: dir,
                interval,
                timestamp: start,
                limit: range.points,
                metrics: [{ name: metric.name }],
            });

            channel.addEventListener("message", (_event, data) => decode(JSON.parse(data)));

            channel.addEventListener("close", (_event, options) => {
                if (options.problem)
                    reject(new Error(String(options.message ?? options.problem)));
                else
                    resolve(samples);
            });
        });
    } finally {
        cockpit.spawn(["rm", "-rf", "--", dir], { err: "ignore" }).catch(() => undefined);
    }
};
