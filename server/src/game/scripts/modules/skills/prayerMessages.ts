const sanitizeBoneName = (rawName?: string): string => {
    const trimmed = rawName?.trim() ?? "";
    return trimmed.length > 0 ? trimmed.toLowerCase() : "bones";
};

const sanitizeAshesName = (rawName?: string): string => {
    const trimmed = rawName?.trim() ?? "";
    return trimmed.length > 0 ? trimmed.toLowerCase() : "ashes";
};

export const formatBuryMessage = (rawName?: string): string => {
    const normalized = sanitizeBoneName(rawName);
    return `You bury the ${normalized}.`;
};

export const formatScatterMessage = (rawName?: string): string => {
    const normalized = sanitizeAshesName(rawName);
    return `You scatter the ${normalized}.`;
};

export const formatOfferMessage = (rawName?: string, count?: number): string => {
    const normalized = sanitizeBoneName(rawName);
    if (count !== undefined && count > 1) {
        return `You offer ${count} ${normalized} at the altar.`;
    }
    return `You offer the ${normalized} at the altar.`;
};
