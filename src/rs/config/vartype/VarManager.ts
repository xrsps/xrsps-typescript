import { BIT_MASKS } from "../../MathConstants";
import { VarcIntTypeLoader } from "./VarcIntTypeLoader";
import { VarBitTypeLoader } from "./bit/VarBitTypeLoader";

/**
 * Custom varbit definition for varbits not in the cache.
 */
export interface CustomVarbitDef {
    baseVar: number;
    startBit: number;
    endBit: number;
}

export interface PersistedVarcsState {
    ints: Array<[number, number]>;
    strings: Array<[number, string]>;
}

export class VarManager {
    // OSRS array limits: Interpreter_arrayLengths = new int[5], Interpreter_arrays = new int[5][5000]
    static readonly MAX_ARRAY_SLOTS = 5;
    static readonly MAX_ARRAY_LENGTH = 5000;

    varbitLoader: VarBitTypeLoader;

    values: Int32Array;
    varcInts: Map<number, number> = new Map();
    varcStrings: Map<number, string> = new Map();
    arrays: Int32Array[] = new Array(VarManager.MAX_ARRAY_SLOTS);
    stringArrays: string[][] = new Array(VarManager.MAX_ARRAY_SLOTS);
    arrayLengths: Int32Array = new Int32Array(VarManager.MAX_ARRAY_SLOTS);
    /** Tracks which slots are string arrays (true) vs int arrays (false) */
    arrayIsString: boolean[] = new Array(VarManager.MAX_ARRAY_SLOTS).fill(false);

    /**
     * Custom varbit definitions for varbits not found in the cache.
     * These are used as fallbacks when the cache loader returns undefined.
     */
    customVarbits: Map<number, CustomVarbitDef> = new Map();

    // Callback when a varp changes - used for onVarTransmit events
    onVarpChange?: (varpId: number, oldValue: number, newValue: number) => void;

    // Callback when a varc int changes - used for onMiscTransmit events (tabs, etc.)
    onVarcIntChange?: (varcId: number, oldValue: number, newValue: number) => void;

    // Callback when a varc string changes - used for chatbox input updates
    onVarcStringChange?: (varcId: number, oldValue: string, newValue: string) => void;

    private persistentVarcs: boolean[] = [];

    constructor(
        varbitLoader: VarBitTypeLoader,
        readonly varcIntTypeLoader?: VarcIntTypeLoader,
    ) {
        this.varbitLoader = varbitLoader;
        this.values = new Int32Array(8000);
        // Pre-allocate arrays like OSRS: Interpreter_arrays = new int[5][5000]
        for (let i = 0; i < VarManager.MAX_ARRAY_SLOTS; i++) {
            this.arrays[i] = new Int32Array(VarManager.MAX_ARRAY_LENGTH);
            this.stringArrays[i] = new Array(VarManager.MAX_ARRAY_LENGTH).fill("");
        }
        this.loadPersistentVarcMetadata();
        // Register built-in custom varbits for league functionality
        this.registerLeagueVarbits();
    }

    private loadPersistentVarcMetadata(): void {
        if (!this.varcIntTypeLoader) {
            this.persistentVarcs = [];
            return;
        }

        const count = this.varcIntTypeLoader.getCount() | 0;
        this.persistentVarcs = new Array<boolean>(count);
        for (let i = 0; i < count; i++) {
            this.persistentVarcs[i] = this.varcIntTypeLoader.load(i).persist === true;
        }
    }

    /**
     * Register a custom varbit definition.
     * This is used for varbits not present in the cache.
     */
    registerVarbit(id: number, baseVar: number, startBit: number, endBit: number): void {
        this.customVarbits.set(id, { baseVar, startBit, endBit });
    }

    /**
     * Register league-related varbits that may not be in the cache.
     * These definitions match OSRS cache r235 varbit layouts.
     */
    private registerLeagueVarbits(): void {
        // Varbit 10046: league_total_tasks_completed
        // Stored in varp 2612, bits 0-15 (16-bit value for task counts 0-65535)
        this.registerVarbit(10046, 2612, 0, 15);

        // Varbit 10037: league_tutorial_completed (already in cache but ensure fallback)
        // Stored in varp 2606, bits 13-17
        this.registerVarbit(10037, 2606, 13, 17);

        // Varbit 10032: league_type
        // Stored in varp 2606, bits 1-4
        this.registerVarbit(10032, 2606, 1, 4);
    }

    /**
     * Get varbit definition from cache or custom definitions.
     */
    private getVarbitDef(
        id: number,
    ): { baseVar: number; startBit: number; endBit: number } | undefined {
        // Try cache first
        const cached = this.varbitLoader.load(id);
        if (cached && cached.baseVar !== undefined) {
            return cached;
        }
        // Fall back to custom definitions
        return this.customVarbits.get(id);
    }

    clear(): void {
        this.values.fill(0);
        this.varcInts.clear();
        this.varcStrings.clear();
        // Clear arrays like OSRS
        for (let i = 0; i < VarManager.MAX_ARRAY_SLOTS; i++) {
            this.arrays[i].fill(0);
            this.stringArrays[i].fill("");
            this.arrayLengths[i] = 0;
            this.arrayIsString[i] = false;
        }
    }

    isPersistentVarc(id: number): boolean {
        return id >= 0 && id < this.persistentVarcs.length && this.persistentVarcs[id] === true;
    }

    restorePersistentVarcs(state?: PersistedVarcsState): void {
        if (!state) {
            return;
        }

        for (const [id, value] of state.ints) {
            if (!this.isPersistentVarc(id)) {
                continue;
            }
            this.varcInts.set(id, value | 0);
        }

        for (const [id, value] of state.strings) {
            if (!this.isPersistentVarc(id)) {
                continue;
            }
            this.varcStrings.set(id, value);
        }
    }

    snapshotPersistentVarcs(): PersistedVarcsState {
        const ints: Array<[number, number]> = [];
        const strings: Array<[number, string]> = [];

        for (const [id, value] of this.varcInts.entries()) {
            if (this.isPersistentVarc(id)) {
                ints.push([id | 0, value | 0]);
            }
        }

        for (const [id, value] of this.varcStrings.entries()) {
            if (this.isPersistentVarc(id)) {
                strings.push([id | 0, value]);
            }
        }

        return { ints, strings };
    }

    clearTransientVarcs(): void {
        if (this.persistentVarcs.length === 0) {
            this.varcInts.clear();
            this.varcStrings.clear();
            return;
        }

        for (const id of Array.from(this.varcInts.keys())) {
            if (!this.isPersistentVarc(id)) {
                this.varcInts.delete(id);
            }
        }

        for (const id of Array.from(this.varcStrings.keys())) {
            if (!this.isPersistentVarc(id)) {
                this.varcStrings.delete(id);
            }
        }
    }

    set(values: Int32Array): void {
        this.values.set(values);
    }

    getVarp(id: number): number {
        return this.values[id];
    }

    setVarp(id: number, value: number): boolean {
        if (id >= this.values.length) {
            return false;
        }
        const oldValue = this.values[id];
        if (oldValue === value) {
            return false;
        }
        this.values[id] = value;
        // Fire change callback for onVarTransmit handling
        if (this.onVarpChange) {
            this.onVarpChange(id, oldValue, value);
        }
        return true;
    }

    getVarbit(id: number): number {
        const varbit = this.getVarbitDef(id);
        if (!varbit) {
            console.warn(`[VarManager] Varbit ${id} not found in loader or custom definitions`);
            return 0;
        }
        const { baseVar, startBit, endBit } = varbit;
        const mask = BIT_MASKS[endBit - startBit];
        const value = (this.values[baseVar] >> startBit) & mask;
        return value;
    }

    setVarbit(id: number, value: number): boolean {
        const varbit = this.getVarbitDef(id);
        if (!varbit) {
            console.warn(
                `[VarManager] Cannot set varbit ${id} - not found in loader or custom definitions`,
            );
            return false;
        }
        const { baseVar, startBit, endBit } = varbit;
        if (baseVar >= this.values.length) {
            return false;
        }
        let mask = BIT_MASKS[endBit - startBit];
        if (value < 0 || (mask !== -1 && value > mask)) {
            value = 0;
        }
        if (this.getVarbit(id) === value) {
            return false;
        }
        const oldVarpValue = this.values[baseVar];
        mask <<= startBit;
        this.values[baseVar] = ((value << startBit) & mask) | (this.values[baseVar] & ~mask);
        // Fire change callback for onVarTransmit handling (varbit changes underlying varp)
        if (this.onVarpChange) {
            this.onVarpChange(baseVar, oldVarpValue, this.values[baseVar]);
        }
        return true;
    }

    getVarcInt(id: number): number {
        return this.varcInts.get(id) ?? 0;
    }

    setVarcInt(id: number, value: number): void {
        const oldValue = this.varcInts.get(id) ?? 0;
        if (oldValue === value) return;
        this.varcInts.set(id, value);
        // Fire change callback for onMiscTransmit handling
        if (this.onVarcIntChange) {
            this.onVarcIntChange(id, oldValue, value);
        }
    }

    getVarcString(id: number): string {
        return this.varcStrings.get(id) ?? "";
    }

    setVarcString(id: number, value: string): void {
        const oldValue = this.varcStrings.get(id) ?? "";
        if (oldValue === value) return;
        this.varcStrings.set(id, value);
        // Fire change callback for chatbox input updates
        if (this.onVarcStringChange) {
            this.onVarcStringChange(id, oldValue, value);
        }
    }

    /**
     * Define an array. The type is encoded in the intOp from DEFINE_ARRAY.
     * @param id Array slot (0-4)
     * @param length Array length
     * @param isString True if this is a string array (type code 's' = 115)
     */
    defineArray(id: number, length: number, isString: boolean = false): void {
        // OSRS only has 5 array slots (0-4)
        if (id < 0 || id >= VarManager.MAX_ARRAY_SLOTS) {
            console.warn(
                `[VarManager] Array slot ${id} out of bounds (max ${
                    VarManager.MAX_ARRAY_SLOTS - 1
                })`,
            );
            return;
        }
        // OSRS limits array length to 5000
        const clampedLength = Math.min(length, VarManager.MAX_ARRAY_LENGTH);
        this.arrayLengths[id] = clampedLength;
        this.arrayIsString[id] = isString;
        // Clear the array portion being used (OSRS doesn't reallocate, just tracks length)
        if (isString) {
            for (let i = 0; i < clampedLength; i++) {
                this.stringArrays[id][i] = "";
            }
        } else {
            this.arrays[id].fill(0, 0, clampedLength);
        }
    }

    getArrayInt(id: number, index: number): number {
        if (id < 0 || id >= VarManager.MAX_ARRAY_SLOTS) {
            return 0;
        }
        if (index >= 0 && index < this.arrayLengths[id]) {
            return this.arrays[id][index];
        }
        return 0;
    }

    setArrayInt(id: number, index: number, value: number): void {
        if (id < 0 || id >= VarManager.MAX_ARRAY_SLOTS) {
            return;
        }
        if (index >= 0 && index < this.arrayLengths[id]) {
            this.arrays[id][index] = value;
        }
    }

    getArrayString(id: number, index: number): string {
        if (id < 0 || id >= VarManager.MAX_ARRAY_SLOTS) {
            return "";
        }
        if (index >= 0 && index < this.arrayLengths[id]) {
            return this.stringArrays[id][index];
        }
        return "";
    }

    setArrayString(id: number, index: number, value: string): void {
        if (id < 0 || id >= VarManager.MAX_ARRAY_SLOTS) {
            return;
        }
        if (index >= 0 && index < this.arrayLengths[id]) {
            this.stringArrays[id][index] = value;
        }
    }

    isStringArray(id: number): boolean {
        if (id < 0 || id >= VarManager.MAX_ARRAY_SLOTS) {
            return false;
        }
        return this.arrayIsString[id];
    }

    sortArray(id: number): void {
        if (id < 0 || id >= VarManager.MAX_ARRAY_SLOTS) {
            return;
        }
        const length = this.arrayLengths[id];
        if (length > 1) {
            // Sort only the used portion of the array
            const slice = this.arrays[id].subarray(0, length);
            slice.sort();
        }
    }

    /**
     * Sort array by string values (for string arrays) or int values (for int arrays),
     * keeping a secondary array in sync.
     * Used by ARRAY_SORT opcode for music sorting.
     * @param primaryId Array slot containing sort keys
     * @param secondaryId Array slot to keep synchronized with primary
     */
    sortArrayPaired(primaryId: number, secondaryId: number): void {
        if (primaryId < 0 || primaryId >= VarManager.MAX_ARRAY_SLOTS) return;
        if (secondaryId < 0 || secondaryId >= VarManager.MAX_ARRAY_SLOTS) return;

        const length = this.arrayLengths[primaryId];
        if (length <= 1) return;

        // Create index array for sorting
        const indices: number[] = [];
        for (let i = 0; i < length; i++) {
            indices.push(i);
        }

        // Sort indices by primary array values
        const isPrimaryString = this.arrayIsString[primaryId];
        if (isPrimaryString) {
            const primaryArr = this.stringArrays[primaryId];
            indices.sort((a, b) => primaryArr[a].localeCompare(primaryArr[b]));
        } else {
            const primaryArr = this.arrays[primaryId];
            indices.sort((a, b) => primaryArr[a] - primaryArr[b]);
        }

        // Apply permutation to both arrays
        const isSecondaryString = this.arrayIsString[secondaryId];

        // Copy original values
        const primaryCopy = isPrimaryString
            ? this.stringArrays[primaryId].slice(0, length)
            : Array.from(this.arrays[primaryId].subarray(0, length));
        const secondaryCopy = isSecondaryString
            ? this.stringArrays[secondaryId].slice(0, length)
            : Array.from(this.arrays[secondaryId].subarray(0, length));

        // Apply sorted order
        for (let i = 0; i < length; i++) {
            const srcIdx = indices[i];
            if (isPrimaryString) {
                this.stringArrays[primaryId][i] = primaryCopy[srcIdx] as string;
            } else {
                this.arrays[primaryId][i] = primaryCopy[srcIdx] as number;
            }
            if (isSecondaryString) {
                this.stringArrays[secondaryId][i] = secondaryCopy[srcIdx] as string;
            } else {
                this.arrays[secondaryId][i] = secondaryCopy[srcIdx] as number;
            }
        }
    }

    getArray(id: number): Int32Array | undefined {
        if (id < 0 || id >= VarManager.MAX_ARRAY_SLOTS) {
            return undefined;
        }
        return this.arrays[id].subarray(0, this.arrayLengths[id]);
    }

    getArrayLength(id: number): number {
        if (id < 0 || id >= VarManager.MAX_ARRAY_SLOTS) {
            return 0;
        }
        return this.arrayLengths[id];
    }

    /**
     * Shuffle array using Fisher-Yates with Java-compatible seeded RNG.
     * Used by ARRAY_SORT_BY opcode.
     */
    shuffleArray(id: number, seedHigh: number, seedLow: number): void {
        if (id < 0 || id >= VarManager.MAX_ARRAY_SLOTS) {
            return;
        }
        const length = this.arrayLengths[id];
        if (length <= 1) {
            return;
        }

        const array = this.arrays[id];

        // Create seed: if both 0, use random seed (matching Java behavior)
        let seedHighVal = seedHigh;
        let seedLowVal = seedLow;
        if (seedHigh === 0 && seedLow === 0) {
            seedHighVal = Math.floor(Math.random() * 0x7fffffff);
            seedLowVal = Math.floor(Math.random() * 0x7fffffff);
        }

        // Combine to 64-bit seed: (seedHigh << 32) | seedLow
        const seed = (BigInt(seedHighVal) << 32n) | BigInt(seedLowVal >>> 0);

        // Java-compatible seeded Random (48-bit LCG)
        // Java's seed initialization: (seed ^ 0x5DEECE66DL) & ((1L << 48) - 1)
        let rngSeed = (seed ^ 0x5deece66dn) & ((1n << 48n) - 1n);

        const nextInt = (bound: number): number => {
            // Advance seed: seed = (seed * 0x5DEECE66DL + 0xBL) & ((1L << 48) - 1)
            rngSeed = (rngSeed * 0x5deece66dn + 0xbn) & ((1n << 48n) - 1n);
            // Get upper 31 bits as signed int
            const bits = Number(rngSeed >> 17n);

            // For power of 2 bounds, simple mask works
            if ((bound & (bound - 1)) === 0) {
                return (bits >>> 0) % bound;
            }

            // General case - rejection sampling for uniform distribution
            let val: number;
            let u = bits;
            while (u - (val = u % bound) + (bound - 1) < 0) {
                rngSeed = (rngSeed * 0x5deece66dn + 0xbn) & ((1n << 48n) - 1n);
                u = Number(rngSeed >> 17n);
            }
            return val;
        };

        // Fisher-Yates shuffle - iterate backwards
        for (let i = length - 1; i > 0; i--) {
            const j = nextInt(i + 1);
            if (i !== j) {
                // Swap elements
                const temp = array[i];
                array[i] = array[j];
                array[j] = temp;
            }
        }
    }
}
