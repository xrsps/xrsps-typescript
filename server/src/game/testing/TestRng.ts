import JavaRandom from "java-random";
import { logger } from "../../utils/logger";

const TEST_RNG_SEED_RAW = process.env.TEST_RNG_SEED?.trim() ?? "";
const TEST_RNG_SEED = TEST_RNG_SEED_RAW ? parseFloat(TEST_RNG_SEED_RAW) : undefined;
const TEST_HIT_FORCE_RAW = process.env.TEST_HIT_FORCE?.trim() ?? "";
export const TEST_HIT_FORCE = TEST_HIT_FORCE_RAW ? parseFloat(TEST_HIT_FORCE_RAW) : undefined;

const testRng: JavaRandom | null =
    TEST_RNG_SEED !== undefined && Number.isFinite(TEST_RNG_SEED)
        ? new JavaRandom(TEST_RNG_SEED)
        : null;

export function testRandFloat(): number {
    if (TEST_HIT_FORCE !== undefined && TEST_HIT_FORCE >= 0) return 0;
    if (testRng?.nextFloat) {
        try {
            return testRng.nextFloat();
        } catch (err) {
            logger.warn("[testRng] nextFloat failed", err);
        }
    }
    return Math.random();
}
