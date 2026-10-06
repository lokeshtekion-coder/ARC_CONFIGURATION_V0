export function parseLaunchDate(value) {
    if (!value)
        return null;
    const trimmed = String(value).trim();
    if (/^\d+$/.test(trimmed)) {
        const num = Number(trimmed);
        const ms = trimmed.length <= 10 ? num * 1000 : num;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
}
export function calculateDiffDays(launchDateStr) {
    const d = parseLaunchDate(launchDateStr);
    if (!d)
        return 999;
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startLaunch = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return Math.round((startLaunch - startToday) / 86400000);
}
