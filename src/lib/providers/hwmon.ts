import { getCockpit } from '../../utils/cockpit';
import type { Cockpit, CockpitSpawnError } from '../../types/cockpit';
import { Provider, ProviderContext, ProviderError, SensorSample, SensorKind } from './types';

interface HwmonSensorDescriptor {
    id: string;
    chipId: string;
    chipLabel: string;
    chipName: string;
    kind: SensorKind;
    label: string;
    unit: string;
    inputPath: string;
    minPath?: string;
    maxPath?: string;
    critPath?: string;
    scale: number;
    min?: number;
    max?: number;
    critical?: number;
}

interface HwmonChipDescriptor {
    id: string;
    name: string;
    label: string;
    sensors: HwmonSensorDescriptor[];
}

const HWMON_ROOT = '/sys/class/hwmon';
const CHIP_LIST_COMMAND = `ls -d ${HWMON_ROOT}/hwmon* 2>/dev/null`;
const SENSOR_LIST_COMMAND = (chipPath: string) => `ls ${chipPath} 2>/dev/null`;

const TRIM = (value: string): string => value.trim();

const parseNumber = (value: string | null | undefined): number | undefined => {
    if (!value) {
        return undefined;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return undefined;
    }

    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const readFile = async (cockpitInstance: Cockpit, path: string): Promise<string | null> => {
    try {
        const handle = cockpitInstance.file(path, { superuser: 'require' });
        const content = await handle.read();
        handle.close();
        return content;
    } catch (error) {
        if (isPermissionDenied(error)) {
            throw new ProviderError('Permission denied while reading hwmon data', 'permission-denied', {
                cause: error instanceof Error ? error : undefined,
            });
        }

        return null;
    }
};

const readNumberFile = async (cockpitInstance: Cockpit, path: string | undefined, scale = 1): Promise<number | undefined> => {
    if (!path) {
        return undefined;
    }

    const content = await readFile(cockpitInstance, path);
    const parsed = parseNumber(content ?? undefined);
    return typeof parsed === 'number' ? parsed * scale : undefined;
};

const isPermissionDenied = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const spawnError = error as CockpitSpawnError & { message?: string };
    if (spawnError.problem === 'access-denied') {
        return true;
    }

    if (typeof spawnError.message === 'string' && /permission denied/i.test(spawnError.message)) {
        return true;
    }

    return false;
};

const spawnText = async (cockpitInstance: Cockpit, command: string[] | string): Promise<string> => {
    try {
        return await cockpitInstance.spawn(command, { superuser: 'require', err: 'out' });
    } catch (error) {
        if (isPermissionDenied(error)) {
            throw new ProviderError('Permission denied while reading hwmon data', 'permission-denied', {
                cause: error instanceof Error ? error : undefined,
            });
        }

        throw new ProviderError('Failed to read hwmon data from the system', 'unexpected', {
            cause: error instanceof Error ? error : undefined,
        });
    }
};

const resolveSensorLabel = async (
    cockpitInstance: Cockpit,
    chipPath: string,
    prefix: string,
    index: string,
    fallback: string,
): Promise<string> => {
    const labelPath = `${chipPath}/${prefix}${index}_label`;
    const namePath = `${chipPath}/${prefix}${index}_name`;

    const label = await readFile(cockpitInstance, labelPath);
    if (label) {
        return TRIM(label);
    }

    const name = await readFile(cockpitInstance, namePath);
    if (name) {
        return TRIM(name);
    }

    return fallback;
};

const sensorKindForPrefix = (prefix: string): SensorKind | null => {
    switch (prefix) {
        case 'temp':
            return 'temp';
        case 'fan':
            return 'fan';
        case 'in':
            return 'volt';
        case 'power':
            return 'power';
        default:
            return null;
    }
};

const unitForKind = (kind: SensorKind): string => {
    switch (kind) {
        case 'temp':
            return '°C';
        case 'fan':
            return 'RPM';
        case 'volt':
            return 'V';
        case 'power':
            return 'W';
        case 'other':
        default:
            return '';
    }
};

const scaleForKind = (kind: SensorKind): number => {
    switch (kind) {
        case 'temp':
        case 'volt':
            return 0.001;
        case 'power':
            return 0.000001;
        case 'fan':
        default:
            return 1;
    }
};

const extractSensorsFromListing = async (
    cockpitInstance: Cockpit,
    chipId: string,
    chipLabel: string,
    chipName: string,
    chipPath: string,
    listing: string,
): Promise<HwmonSensorDescriptor[]> => {
    const entries = listing
            .split('\n')
            .map(TRIM)
            .filter(entry => entry.endsWith('_input'));

    const descriptors: HwmonSensorDescriptor[] = [];

    for (const entry of entries) {
        const match = entry.match(/^(?<prefix>[a-z]+)(?<index>\d+)_input$/);
        if (!match || !match.groups) {
            continue;
        }

        const prefix = match.groups.prefix;
        const index = match.groups.index;
        const kind = sensorKindForPrefix(prefix);
        if (!kind) {
            continue;
        }

        const label = await resolveSensorLabel(cockpitInstance, chipPath, prefix, index, `${chipLabel} ${prefix}${index}`);
        const unit = unitForKind(kind);
        const scale = scaleForKind(kind);

        descriptors.push({
            id: `${chipId}:${prefix}${index}`,
            chipId,
            chipLabel,
            chipName,
            kind,
            label,
            unit,
            scale,
            inputPath: `${chipPath}/${entry}`,
            minPath: `${chipPath}/${prefix}${index}_min`,
            maxPath: `${chipPath}/${prefix}${index}_max`,
            critPath: `${chipPath}/${prefix}${index}_crit`,
        });
    }

    return descriptors;
};

const buildChipDescriptors = async (cockpitInstance: Cockpit): Promise<HwmonChipDescriptor[]> => {
    const rawList = await spawnText(cockpitInstance, ['sh', '-c', CHIP_LIST_COMMAND]).catch(error => {
        if (error instanceof ProviderError && error.code === 'unexpected') {
            return '';
        }

        throw error;
    });
    const chipPaths = rawList
            .split('\n')
            .map(TRIM)
            .filter(path => path.length > 0);

    const chips: HwmonChipDescriptor[] = [];

    for (const chipPath of chipPaths) {
        const name = (await readFile(cockpitInstance, `${chipPath}/name`)) ?? '';
        const label = name ? TRIM(name) : chipPath.split('/').pop() ?? chipPath;
        const id = chipPath.split('/').pop() ?? chipPath;

        const listing = await spawnText(cockpitInstance, ['sh', '-c', SENSOR_LIST_COMMAND(chipPath)]).catch(error => {
            if (error instanceof ProviderError && error.code === 'unexpected') {
                return '';
            }

            throw error;
        });
        const sensors = await extractSensorsFromListing(cockpitInstance, id, label, label, chipPath, listing);

        if (sensors.length === 0) {
            continue;
        }

        chips.push({
            id,
            name: label,
            label,
            sensors,
        });
    }

    return chips;
};

const buildSample = (descriptor: HwmonSensorDescriptor, value: number): SensorSample => ({
    kind: descriptor.kind,
    id: descriptor.id,
    label: descriptor.label,
    value,
    min: descriptor.min,
    max: descriptor.max,
    critical: descriptor.critical,
    unit: descriptor.unit,
    chipId: descriptor.chipId,
    chipLabel: descriptor.chipLabel,
    chipName: descriptor.chipName,
});

export class HwmonProvider implements Provider {
    readonly name = 'hwmon';
    private throttleTimeout: number | undefined;

    async isAvailable(): Promise<boolean> {
        const cockpitInstance = getCockpit();
        const output = await spawnText(
            cockpitInstance,
            ['sh', '-c', `find ${HWMON_ROOT} -maxdepth 2 -type f -name "*_input" -print -quit`],
        ).catch(error => {
            if (error instanceof ProviderError && error.code === 'permission-denied') {
                throw error;
            }

            return '';
        });
        return output.trim().length > 0;
    }

    start(onChange: (samples: SensorSample[]) => void, context?: ProviderContext) {
        const cockpitInstance = getCockpit();
        let disposed = false;
        const watches: Array<() => void> = [];
        const currentValues = new Map<string, number>();
        const descriptors = new Map<string, HwmonSensorDescriptor>();

        const emit = () => {
            if (disposed) {
                return;
            }

            if (typeof window !== 'undefined') {
                if (this.throttleTimeout) {
                    window.clearTimeout(this.throttleTimeout);
                }

                this.throttleTimeout = window.setTimeout(() => {
                    const samples: SensorSample[] = [];
                    for (const [id, descriptor] of descriptors) {
                        const value = currentValues.get(id);
                        if (typeof value !== 'number') {
                            continue;
                        }

                        samples.push(buildSample(descriptor, value));
                    }
                    onChange(samples);
                }, 500);
                return;
            }

            const samples: SensorSample[] = [];
            for (const [id, descriptor] of descriptors) {
                const value = currentValues.get(id);
                if (typeof value !== 'number') {
                    continue;
                }
                samples.push(buildSample(descriptor, value));
            }
            onChange(samples);
        };

        const attachWatchers = async () => {
            try {
                const chips = await buildChipDescriptors(cockpitInstance);
                if (chips.length === 0) {
                    onChange([]);
                    return;
                }

                for (const chip of chips) {
                    for (const sensor of chip.sensors) {
                        descriptors.set(sensor.id, sensor);

                        const initialValue = await readNumberFile(
                            cockpitInstance,
                            sensor.inputPath,
                            sensor.scale,
                        );
                        if (typeof initialValue === 'number') {
                            currentValues.set(sensor.id, initialValue);
                        }

                        sensor.min = await readNumberFile(cockpitInstance, sensor.minPath, sensor.scale);
                        sensor.max = await readNumberFile(cockpitInstance, sensor.maxPath, sensor.scale);
                        sensor.critical = await readNumberFile(cockpitInstance, sensor.critPath, sensor.scale);

                        const handle = cockpitInstance.file(sensor.inputPath, { superuser: 'require' });
                        const stop = handle.watch(content => {
                            if (disposed) {
                                return;
                            }

                            if (content === null) {
                                currentValues.delete(sensor.id);
                                emit();
                                return;
                            }

                            const parsed = parseNumber(content);
                            if (typeof parsed !== 'number') {
                                return;
                            }

                            const value = parsed * sensor.scale;
                            currentValues.set(sensor.id, value);
                            emit();
                        });

                        watches.push(() => {
                            stop?.();
                            handle.close();
                        });
                    }
                }

                emit();
            } catch (error) {
                const providerError =
                    error instanceof ProviderError
                        ? error
                        : new ProviderError((error as Error).message || 'hwmon failure', 'unexpected', {
                            cause: error instanceof Error ? error : undefined,
                        });
                context?.onError?.(providerError);
            }
        };

        void attachWatchers();

        return () => {
            disposed = true;
            if (typeof window !== 'undefined' && this.throttleTimeout) {
                window.clearTimeout(this.throttleTimeout);
                this.throttleTimeout = undefined;
            }
            for (const cancel of watches) {
                try {
                    cancel();
                } catch (error) {
                    console.error('Failed to stop hwmon watcher', error);
                }
            }
            watches.length = 0;
        };
    }
}

export const hwmonProvider = new HwmonProvider();
