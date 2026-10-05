// Minimal stand-in for Cockpit's cockpit.js, for unit tests of pure functions in node
const format = (fmt, ...args) => fmt.replace(/\$([0-9]+)/g, (_m, i) => String(args[i]));

export default {
    gettext: (message) => message,
    ngettext: (one, many, n) => n === 1 ? one : many,
    format,
};
