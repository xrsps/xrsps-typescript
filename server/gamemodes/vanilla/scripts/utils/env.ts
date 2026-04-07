function readEnvText(name: string): string | undefined {
    const raw = process.env[name];
    if (raw === undefined) {
        return undefined;
    }

    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

const INTEGER_ENV_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;

function parseEnvInteger(name: string): number | undefined {
    const raw = readEnvText(name);
    if (raw === undefined) {
        return undefined;
    }

    if (!INTEGER_ENV_PATTERN.test(raw)) {
        return undefined;
    }

    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }

    return Math.trunc(parsed);
}

export function readPositiveEnvInteger(name: string): number | undefined {
    const parsed = parseEnvInteger(name);
    return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

export function readNonNegativeEnvInteger(name: string): number | undefined {
    const parsed = parseEnvInteger(name);
    return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}
