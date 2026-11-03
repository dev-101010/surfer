'use strict';

const os = require('os');

function cpuTimes() {
    let idle = 0;
    let total = 0;
    for (const cpu of os.cpus()) {
        const t = cpu.times;
        idle += t.idle;
        total += t.user + t.nice + t.sys + t.irq + t.idle;
    }
    return {idle, total};
}

/**
 * Returns a sampler function. Each call returns the system-wide CPU usage in percent
 * since the previous call of *this* sampler (independent samplers don't disturb each other).
 */
function createCpuSampler() {
    let prev = cpuTimes();
    return () => {
        const cur = cpuTimes();
        const idle = cur.idle - prev.idle;
        const total = cur.total - prev.total;
        prev = cur;
        if (total <= 0) return 0;
        return Math.max(0, Math.min(100, (1 - idle / total) * 100));
    };
}

function memoryUsage() {
    const total = os.totalmem();
    const free = os.freemem();
    return {
        totalMB: Math.round(total / 1048576),
        usedMB: Math.round((total - free) / 1048576),
        percent: total > 0 ? (1 - free / total) * 100 : 0
    };
}

module.exports = {createCpuSampler, memoryUsage};
