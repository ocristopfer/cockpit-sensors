# Cockpit Sensors

Cockpit module (React + TypeScript + PatternFly 6) that shows lm-sensors readings and
their history recorded with PCP. Sources are in `src/`, built with `./build.js` (esbuild).

## Commits

- Every commit must be authored **and** committed as `Cristopfer Luis <ocristopfer@gmail.com>`
  (set `git config user.name "Cristopfer Luis"` and `git config user.email ocristopfer@gmail.com`).
- Do **not** add `Co-Authored-By: Claude ...`, `Claude-Session: ...` or any other AI
  attribution trailer to commit messages or pull request descriptions.
- Branch names must not mention Claude or AI either; use descriptive names such as
  `feat/<topic>` or `fix/<topic>`.

## Checks before pushing

```shell
make pkg/lib/cockpit-po-plugin.js   # fetch Cockpit's pkg/lib once
npm install
npm run build
npm run eslint
npm run stylelint
npx tsc --noEmit
npm run test:unit
```

Integration tests (`test/check-application`) need a Cockpit test VM: `make check`.
