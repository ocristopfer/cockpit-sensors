/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Per-browser settings, kept in localStorage. Storage can be unavailable
 * (private windows, blocked site data), so every access is guarded.
 */

import { useCallback, useState } from "react";

export const readPreference = <T, >(key: string, fallback: T): T => {
    try {
        const stored = localStorage.getItem(key);
        return stored === null ? fallback : JSON.parse(stored) as T;
    } catch {
        return fallback;
    }
};

export const writePreference = <T, >(key: string, value: T): void => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // not remembered, but still applied for this session
    }
};

export const usePreference = <T, >(key: string, fallback: T): [T, (value: T) => void] => {
    const [value, setValue] = useState<T>(() => readPreference(key, fallback));
    const update = useCallback((newValue: T) => {
        setValue(newValue);
        writePreference(key, newValue);
    }, [key]);
    return [value, update];
};
