#!/usr/bin/env node
// Bundles the unit tests with esbuild (Cockpit replaced by a stub) and runs them with QUnit
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';

const dir = path.dirname(fileURLToPath(import.meta.url));
const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensors-unit-'));
const tests = fs.readdirSync(dir).filter(f => f.endsWith('.test.ts')).map(f => path.join(dir, f));

try {
    await esbuild.build({
        entryPoints: tests,
        bundle: true,
        platform: 'node',
        format: 'esm',
        outdir,
        outExtension: { '.js': '.mjs' },
        alias: { cockpit: path.join(dir, 'cockpit-stub.js') },
        logLevel: 'warning',
    });
    const outputs = fs.readdirSync(outdir).map(f => path.join(outdir, f));
    execFileSync(path.join(dir, '../../node_modules/.bin/qunit'), outputs, { stdio: 'inherit' });
} catch (e) {
    process.exitCode = e.status ?? 1;
} finally {
    fs.rmSync(outdir, { recursive: true, force: true });
}
