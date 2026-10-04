/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Sensor history through Performance Co-Pilot (PCP): the lm-sensors PMDA
 * (pmdalmsensors) exports every sensor's current value as
 * lmsensors.<chip>.<label>, pmlogger records it, and Cockpit's "metrics1"
 * channel reads it back from the pmlogger archives.
 */

import cockpit from "cockpit";

export type HistoryStatus =
    | "loading"
    | "no-pcp" // PCP is not installed
    | "no-pmda" // the lm-sensors PMDA is not installed or exports no metrics
    | "no-logger" // pmlogger does not record lmsensors, or is not running
    | "no-python" // python3-pcp is missing, Cockpit cannot read archives
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

// sensors that pmdalmsensors exports: the ones with an *_input sub-feature
export const hasHistory = (values: Record<string, number>): boolean =>
    Object.keys(values).some(key => key.includes("_input"));

const STATUS_SCRIPT = `
if ! command -v pminfo >/dev/null 2>&1; then echo no-pcp; exit 0; fi
. /etc/pcp.env
pminfo lmsensors >/dev/null 2>&1 || { echo no-pmda; exit 0; }
grep -q '^#+ cockpit-sensors/lmsensors:y' "$PCP_VAR_DIR/config/pmlogger/config.default" 2>/dev/null || { echo no-logger; exit 0; }
systemctl is-active -q pmlogger || { echo no-logger; exit 0; }
python3 -c 'import pcp' 2>/dev/null || { echo no-python; exit 0; }
echo enabled
`;

export const getHistoryStatus = async (): Promise<HistoryStatus> => {
    const out = await cockpit.script(STATUS_SCRIPT, { err: "message" });
    return out.trim() as HistoryStatus;
};

// PCP packages per distribution, null when PCP is not packaged in the official repositories
export const pcpPackages = (osIds: string[]): string[] | null => {
    for (const osId of osIds) {
        switch (osId) {
        case "fedora":
        case "rhel":
        case "centos":
            return ["pcp", "python3-pcp", "pcp-pmda-lmsensors"];
        case "debian":
        case "ubuntu":
            // the lm-sensors PMDA is part of the pcp package
            return ["pcp", "python3-pcp"];
        case "suse":
        case "opensuse":
            return ["pcp", "python3-pcp", "pcp-pmda-lmsensors"];
        }
    }
    return null;
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

export const enableHistory = async (osIds: string[]): Promise<void> => {
    const packages = pcpPackages(osIds);
    if (!packages)
        throw new Error(cockpit.format(cockpit.gettext("PCP is not available for $0"), osIds[0] ?? "unknown"));

    await cockpit.script(ENABLE_SCRIPT, installCommand(osIds, packages), {
        err: "message",
        superuser: "require",
        environ: ["DEBIAN_FRONTEND=noninteractive"],
    });
};

/*
 * Cockpit's metrics channel reads every archive of a directory and gives up
 * when the metric is missing from any of them, which is the case for archives
 * written before sensor history was enabled (or before a sensor appeared).
 * So link the archives that cover the range and contain the metric into a
 * temporary directory, and read that one. Archive names carry their start time
 * in the server's local time zone, so all of this runs on the server.
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

add() {
    if pminfo -a "$1" "$metric" >/dev/null 2>&1; then
        ln -s "$1".* "$dir"/
    fi
}

prev=""
for f in "$src"/*.index; do
    [ -e "$f" ] || continue
    archive=$(echo "$f" | sed 's/\.index$//')
    stamp=$(basename "$archive" | sed -n 's/^\([0-9]\{4\}\)\([0-9]\{2\}\)\([0-9]\{2\}\)\.\([0-9]\{2\}\)\.\([0-9]\{2\}\).*/\1-\2-\3 \4:\5/p')
    [ -n "$stamp" ] || continue
    # the previous archive ends where this one starts
    if [ -n "$prev" ] && [ "$(date -d "$stamp" +%s)" -gt "$start" ]; then
        add "$prev"
    fi
    prev="$archive"
done
[ -z "$prev" ] || add "$prev"

if [ -z "$(ls -A "$dir")" ]; then
    rmdir "$dir"
else
    echo "$dir"
fi
`;

/*
 * Read the recorded values of one metric for a range from the pmlogger archives.
 * Resolves to [] when nothing was recorded yet.
 */
export const loadHistory = async (metric: string, range: HistoryRange): Promise<HistorySample[]> => {
    const start = Date.now() - range.durationMs;
    const interval = Math.round(range.durationMs / range.points);

    const dir = (await cockpit.script(PREPARE_ARCHIVES_SCRIPT, [metric, String(Math.floor(start / 1000))],
                                      { err: "message" })).trim();
    if (!dir)
        return [];

    try {
        return await new Promise((resolve, reject) => {
            const samples: HistorySample[] = [];
            let timestamp = 0;
            let step = interval;
            let current: number | null = null;

            const channel = cockpit.channel({
                payload: "metrics1",
                source: dir,
                interval,
                timestamp: start,
                limit: range.points,
                metrics: [{ name: metric }],
            });

            channel.addEventListener("message", (_event, data) => {
                const message = JSON.parse(data);

                // meta message: start time and interval of the following data messages
                if (!Array.isArray(message)) {
                    timestamp = message.timestamp;
                    step = message.interval;
                    return;
                }

                // data messages are compressed: null (or a shorter array) means "unchanged", false means "no value"
                for (const sample of message as (number | null | false)[][]) {
                    const value = sample[0];
                    if (typeof value === "number")
                        current = value;
                    else if (value === false)
                        current = null;
                    samples.push({ t: timestamp, v: current });
                    timestamp += step;
                }
            });

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
