import { CacheInfo } from "../../cache/CacheInfo";
import { ByteBuffer } from "../../io/ByteBuffer";
import { ParamsMap, Type } from "../Type";
import { BasTypeLoader } from "../bastype/BasTypeLoader";
import { VarManager } from "../vartype/VarManager";
import { NpcTypeLoader } from "./NpcTypeLoader";

export enum NpcDrawPriority {
    DRAW_PRIORITY_FIRST = 0,
    DRAW_PRIORITY_DEFAULT = 1,
    DRAW_PRIORITY_LAST = 2,
}

export class NpcType extends Type {
    name: string;
    desc?: string;

    size: number;

    modelIds!: number[];
    chatheadModelIds!: number[];
    idleSeqId: number;
    turnLeftSeqId: number;
    turnRightSeqId: number;

    walkSeqId: number;
    walkBackSeqId: number;
    walkLeftSeqId: number;
    walkRightSeqId: number;

    recolorFrom!: number[];
    recolorTo!: number[];

    retextureFrom!: number[];
    retextureTo!: number[];

    actions: string[];

    drawMapDot: boolean;

    combatLevel: number;

    /**
     * OSRS (newer revisions): NPC combat stats provided as 6 ushorts via opcodes 74..79.
     * These are used for server-side combat calculations and should not be guessed from params.
     */
    attackLevel: number;
    defenceLevel: number;
    strengthLevel: number;
    hitpoints: number;
    rangedLevel: number;
    magicLevel: number;
    /** Attack speed in game ticks. Default -1 means use combat def or fallback to 4. */
    attackSpeed: number;

    widthScale: number;
    heightScale: number;

    isVisible: boolean;
    drawPriority: NpcDrawPriority;

    ambient: number;
    contrast: number;

    headIconPrayer: number;
    headIconSpriteIds?: number[];
    headIconSpriteIndices?: number[];

    rotationSpeed: number;
    canHideForOverlap?: boolean;
    overlapTintHsl?: number;

    transforms!: number[];
    transformVarbit: number;
    transformVarp: number;

    isInteractable: boolean;
    isClickable: boolean;
    isClipped: boolean;
    isFollower: boolean;

    runSeqId: number;
    runBackSeqId: number;
    runLeftSeqId: number;
    runRightSeqId: number;

    crawlSeqId: number;
    crawlBackSeqId: number;
    crawlLeftSeqId: number;
    crawlRightSeqId: number;

    category: number;

    loginScreenProps: number;
    spawnDirection: number;
    heightOffset: number;
    footprintSize: number;

    basTypeId: number;

    params!: ParamsMap;
    isPet?: boolean;

    constructor(id: number, cacheInfo: CacheInfo) {
        super(id, cacheInfo);
        this.name = "null";
        this.size = 1;
        this.idleSeqId = -1;
        this.turnLeftSeqId = -1;
        this.turnRightSeqId = -1;
        this.walkSeqId = -1;
        this.walkBackSeqId = -1;
        this.walkLeftSeqId = -1;
        this.walkRightSeqId = -1;
        this.actions = new Array<string>(5);
        this.drawMapDot = true;
        this.combatLevel = -1;
        this.attackLevel = -1;
        this.defenceLevel = -1;
        this.strengthLevel = -1;
        this.hitpoints = -1;
        this.rangedLevel = -1;
        this.magicLevel = -1;
        this.attackSpeed = -1;
        this.widthScale = 128;
        this.heightScale = 128;
        this.isVisible = false;
        this.drawPriority = NpcDrawPriority.DRAW_PRIORITY_DEFAULT;
        this.ambient = 0;
        this.contrast = 0;
        this.headIconPrayer = -1;
        this.rotationSpeed = 32;
        this.canHideForOverlap = false;
        this.overlapTintHsl = -1;
        this.transformVarbit = -1;
        this.transformVarp = -1;
        this.isInteractable = true;
        this.isClickable = true;
        this.isClipped = true;
        this.isFollower = false;
        this.runSeqId = -1;
        this.runBackSeqId = -1;
        this.runLeftSeqId = -1;
        this.runRightSeqId = -1;
        this.crawlSeqId = -1;
        this.crawlBackSeqId = -1;
        this.crawlLeftSeqId = -1;
        this.crawlRightSeqId = -1;
        this.category = -1;
        this.loginScreenProps = 0;
        // this.spawnDirection = 7;
        this.spawnDirection = 6;
        this.heightOffset = -1;
        this.footprintSize = -1;
        this.basTypeId = -1;
        this.isPet = false;
    }

    isLargeModelId(): boolean {
        return this.cacheInfo.game === "runescape" && this.cacheInfo.revision >= 670;
    }

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        if (opcode === 1) {
            const count = buffer.readUnsignedByte();
            this.modelIds = new Array<number>(count);

            if (this.isLargeModelId()) {
                for (let i = 0; i < count; i++) {
                    this.modelIds[i] = buffer.readBigSmart();
                }
            } else {
                for (let i = 0; i < count; i++) {
                    this.modelIds[i] = buffer.readUnsignedShort();
                }
            }
        } else if (opcode === 2) {
            this.name = this.readString(buffer);
        } else if (opcode === 3) {
            this.desc = this.readString(buffer);
        } else if (opcode === 12) {
            this.size = buffer.readUnsignedByte();
        } else if (opcode === 13) {
            this.idleSeqId = buffer.readUnsignedShort();
        } else if (opcode === 14) {
            this.walkSeqId = buffer.readUnsignedShort();
        } else if (opcode === 15) {
            this.turnLeftSeqId = buffer.readUnsignedShort();
        } else if (opcode === 16) {
            if (this.cacheInfo.game === "runescape" && this.cacheInfo.revision < 254) {
                // disposeAlpha?
            } else {
                this.turnRightSeqId = buffer.readUnsignedShort();
            }
        } else if (opcode === 17) {
            this.walkSeqId = buffer.readUnsignedShort();
            this.walkBackSeqId = buffer.readUnsignedShort();
            this.walkLeftSeqId = buffer.readUnsignedShort();
            this.walkRightSeqId = buffer.readUnsignedShort();
        } else if (opcode === 18) {
            this.category = buffer.readUnsignedShort();
        } else if (opcode >= 30 && opcode < 35) {
            this.actions[opcode - 30] = this.readString(buffer);
            if (this.actions[opcode - 30].toLowerCase() === "hidden") {
                delete this.actions[opcode - 30];
            }
        } else if (opcode === 40) {
            const count = buffer.readUnsignedByte();
            this.recolorFrom = new Array<number>(count);
            this.recolorTo = new Array<number>(count);

            for (let i = 0; i < count; i++) {
                this.recolorFrom[i] = buffer.readUnsignedShort();
                this.recolorTo[i] = buffer.readUnsignedShort();
            }
        } else if (opcode === 41) {
            const count = buffer.readUnsignedByte();
            this.retextureFrom = new Array<number>(count);
            this.retextureTo = new Array<number>(count);

            for (let i = 0; i < count; i++) {
                this.retextureFrom[i] = buffer.readUnsignedShort();
                this.retextureTo[i] = buffer.readUnsignedShort();
            }
        } else if (opcode === 44 || opcode === 45) {
            buffer.readUnsignedShort();
        } else if (opcode === 60) {
            const count = buffer.readUnsignedByte();
            this.chatheadModelIds = new Array<number>(count);

            if (this.isLargeModelId()) {
                for (let i = 0; i < count; i++) {
                    this.chatheadModelIds[i] = buffer.readBigSmart();
                }
            } else {
                for (let i = 0; i < count; i++) {
                    this.chatheadModelIds[i] = buffer.readUnsignedShort();
                }
            }
        } else if (opcode === 61) {
            const count = buffer.readUnsignedByte();
            this.modelIds = new Array<number>(count);
            for (let i = 0; i < count; i++) {
                this.modelIds[i] = buffer.readInt();
            }
        } else if (opcode === 62) {
            const count = buffer.readUnsignedByte();
            this.chatheadModelIds = new Array<number>(count);
            for (let i = 0; i < count; i++) {
                this.chatheadModelIds[i] = buffer.readInt();
            }
        } else if (opcode === 74) {
            const v = buffer.readUnsignedShort();
            this.attackLevel = v === 65535 ? -1 : v;
        } else if (opcode === 75) {
            const v = buffer.readUnsignedShort();
            this.defenceLevel = v === 65535 ? -1 : v;
        } else if (opcode === 76) {
            const v = buffer.readUnsignedShort();
            this.strengthLevel = v === 65535 ? -1 : v;
        } else if (opcode === 77) {
            const v = buffer.readUnsignedShort();
            this.hitpoints = v === 65535 ? -1 : v;
        } else if (opcode === 78) {
            const v = buffer.readUnsignedShort();
            this.rangedLevel = v === 65535 ? -1 : v;
        } else if (opcode === 79) {
            const v = buffer.readUnsignedShort();
            this.magicLevel = v === 65535 ? -1 : v;
        } else if (opcode === 93) {
            this.drawMapDot = false;
        } else if (opcode === 95) {
            this.combatLevel = buffer.readUnsignedShort();
        } else if (opcode === 97) {
            this.widthScale = buffer.readUnsignedShort();
        } else if (opcode === 98) {
            this.heightScale = buffer.readUnsignedShort();
        } else if (opcode === 99) {
            this.drawPriority = NpcDrawPriority.DRAW_PRIORITY_FIRST;
        } else if (opcode === 100) {
            this.ambient = buffer.readByte();
        } else if (opcode === 101) {
            this.contrast = buffer.readByte() * 5;
        } else if (opcode === 102) {
            if (
                (this.cacheInfo.game === "oldschool" && this.cacheInfo.revision < 210) ||
                this.cacheInfo.game === "runescape"
            ) {
                // Legacy single head-icon value
                this.headIconPrayer = buffer.readUnsignedShort();
            } else {
                // OSRS newer format: bitmask of multiple head icons
                let mask = buffer.readUnsignedByte();
                // Count set bits
                let count = 0;
                for (let n = mask; n !== 0; n &= n - 1) count++;

                this.headIconSpriteIds = new Array(count);
                this.headIconSpriteIndices = new Array(count);

                let out = 0;
                for (let bit = 0; mask !== 0; bit++) {
                    if ((mask & 1) !== 0) {
                        this.headIconSpriteIds[out] = buffer.readBigSmart();
                        this.headIconSpriteIndices[out] = buffer.readUnsignedSmartMin1();
                        out++;
                    }
                    mask >>= 1;
                }
            }
        } else if (opcode === 103) {
            this.rotationSpeed = buffer.readUnsignedShort();
        } else if (opcode === 106 || opcode === 118) {
            this.transformVarbit = buffer.readUnsignedShort();
            if (this.transformVarbit === 65535) {
                this.transformVarbit = -1;
            }

            this.transformVarp = buffer.readUnsignedShort();
            if (this.transformVarp === 65535) {
                this.transformVarp = -1;
            }

            let var3 = -1;
            if (opcode === 118) {
                var3 = buffer.readUnsignedShort();
                if (var3 === 65535) {
                    var3 = -1;
                }
            }

            const count = buffer.readUnsignedByte();
            this.transforms = new Array<number>(count + 2);

            for (let i = 0; i <= count; i++) {
                this.transforms[i] = buffer.readUnsignedShort();
                if (this.transforms[i] === 65535) {
                    this.transforms[i] = -1;
                }
            }

            this.transforms[count + 1] = var3;
        } else if (opcode === 107) {
            this.isInteractable = false;
        } else if (opcode === 109) {
            this.isClipped = false;
        } else if (opcode === 111) {
            if (this.cacheInfo.game === "oldschool") {
                this.drawPriority = NpcDrawPriority.DRAW_PRIORITY_LAST;
            } else {
                // hasShadow = false
            }
        } else if (opcode === 112) {
            // old
        } else if (opcode === 113) {
            const shadowColor1 = buffer.readUnsignedShort();
            const shadowColor2 = buffer.readUnsignedShort();
        } else if (opcode === 114) {
            if (this.cacheInfo.game === "oldschool") {
                this.runSeqId = buffer.readUnsignedShort();
            } else {
                const shadowColorMod1 = buffer.readByte();
                const shadowColorMod2 = buffer.readByte();
            }
        } else if (opcode === 115) {
            if (this.cacheInfo.game === "oldschool") {
                this.runSeqId = buffer.readUnsignedShort();
                this.runBackSeqId = buffer.readUnsignedShort();
                this.runLeftSeqId = buffer.readUnsignedShort();
                this.runRightSeqId = buffer.readUnsignedShort();
            } else {
                buffer.readUnsignedByte();
                buffer.readUnsignedByte();
            }
        } else if (opcode === 116) {
            this.crawlSeqId = buffer.readUnsignedShort();
        } else if (opcode === 117) {
            this.crawlSeqId = buffer.readUnsignedShort();
            this.crawlBackSeqId = buffer.readUnsignedShort();
            this.crawlLeftSeqId = buffer.readUnsignedShort();
            this.crawlRightSeqId = buffer.readUnsignedShort();
        } else if (opcode === 119) {
            this.loginScreenProps = buffer.readByte();
        } else if (opcode === 121) {
            const modelOffsets = new Array<number[]>(this.modelIds.length);
            const count = buffer.readUnsignedByte();
            for (let i = 0; i < count; i++) {
                const index = buffer.readUnsignedByte();
                const offsets = (modelOffsets[index] = new Array(3));
                offsets[0] = buffer.readByte();
                offsets[1] = buffer.readByte();
                offsets[2] = buffer.readByte();
            }
        } else if (opcode === 122) {
            if (this.cacheInfo.game === "oldschool") {
                this.isFollower = true;
            } else {
                if (this.isLargeModelId()) {
                    const hitBarSpriteId = buffer.readBigSmart();
                } else {
                    const hitBarSpriteId = buffer.readUnsignedShort();
                }
            }
        } else if (opcode === 123) {
            if (this.cacheInfo.game === "oldschool") {
                // lowPriorityFollowerOps = true;
            } else {
                const iconHeight = buffer.readUnsignedShort();
            }
        } else if (opcode === 124) {
            const value = buffer.readUnsignedShort();
            this.heightOffset = value === 0xffff ? -1 : value;
        } else if (opcode === 125) {
            this.spawnDirection = buffer.readByte();
        } else if (opcode === 126) {
            this.footprintSize = buffer.readUnsignedShort();
        } else if (opcode === 127) {
            this.basTypeId = buffer.readUnsignedShort();
        } else if (opcode === 128) {
            buffer.readUnsignedByte();
        } else if (opcode === 130) {
            // readyanimduringanim = true;
        } else if (opcode === 134) {
            const idleSound = buffer.readUnsignedShort();
            const crawlSound = buffer.readUnsignedShort();
            const walkSound = buffer.readUnsignedShort();
            const runSound = buffer.readUnsignedShort();
        } else if (opcode === 135) {
            const cursor1op = buffer.readUnsignedByte();
            const cursor1 = buffer.readUnsignedShort();
        } else if (opcode === 136) {
            const cursor2op = buffer.readUnsignedByte();
            const cursor2 = buffer.readUnsignedShort();
        } else if (opcode === 137) {
            const attackCursor = buffer.readUnsignedShort();
        } else if (opcode === 138) {
            if (this.isLargeModelId()) {
                const icon = buffer.readBigSmart();
            } else {
                const icon = buffer.readUnsignedShort();
            }
        } else if (opcode === 139) {
            if (this.isLargeModelId()) {
                const icon = buffer.readBigSmart();
            } else {
                const icon = buffer.readUnsignedShort();
            }
        } else if (opcode === 140) {
            const ambientSoundVolume = buffer.readUnsignedByte();
        } else if (opcode === 141) {
            const bool = true;
        } else if (opcode === 142) {
            const mapFunctionId = buffer.readUnsignedShort();
        } else if (opcode === 143) {
            const bool = true;
        } else if (opcode === 144) {
            buffer.readUnsignedShort();
        } else if (opcode === 145) {
            // Newer OSRS: allows NPC to hide when overlapped by scenery (eg. Kraken in pools)
            this.canHideForOverlap = true;
        } else if (opcode === 146) {
            // Tint applied when overlapped; stored as packed HSL
            this.overlapTintHsl = buffer.readUnsignedShort();
        } else if (opcode === 147) {
            // Unknown OSRS boolean flag with no payload; present on Thurgo in rev 236.
        } else if (opcode >= 150 && opcode < 155) {
            // member only options
            this.actions[opcode - 150] = this.readString(buffer);
            const isMember = true;
            if (!isMember || this.actions[opcode - 150].toLowerCase() === "hidden") {
                delete this.actions[opcode - 150];
            }
        } else if (opcode === 155) {
            const b0 = buffer.readByte();
            const b1 = buffer.readByte();
            const b2 = buffer.readByte();
            const b3 = buffer.readByte();
        } else if (opcode === 158) {
            const b = 1;
        } else if (opcode === 159) {
            const b = 0;
        } else if (opcode === 160) {
            const count = buffer.readUnsignedByte();
            for (let i = 0; i < count; i++) {
                const v = buffer.readUnsignedShort();
            }
        } else if (opcode === 161) {
            const bool = true;
        } else if (opcode === 162) {
            const bool = true;
        } else if (opcode === 163) {
            const v = buffer.readUnsignedByte();
        } else if (opcode === 164) {
            const v0 = buffer.readUnsignedShort();
            const v1 = buffer.readUnsignedShort();
        } else if (opcode === 165) {
            const v = buffer.readUnsignedByte();
        } else if (opcode === 168) {
            const v = buffer.readUnsignedByte();
        } else if (opcode >= 170 && opcode < 176) {
            buffer.readUnsignedShort();
        } else if (opcode === 251) {
            const index = buffer.readUnsignedByte();
            const subId = buffer.readUnsignedByte();
            this.readString(buffer);
        } else if (opcode === 252) {
            const index = buffer.readUnsignedByte();
            const varp = buffer.readUnsignedShort();
            const varb = buffer.readUnsignedShort();
            const min = buffer.readInt();
            const max = buffer.readInt();
            this.readString(buffer);
        } else if (opcode === 253) {
            const index = buffer.readUnsignedByte();
            const subId = buffer.readUnsignedShort();
            const varp = buffer.readUnsignedShort();
            const varb = buffer.readUnsignedShort();
            const min = buffer.readInt();
            const max = buffer.readInt();
            this.readString(buffer);
        } else if (opcode === 249) {
            this.params = Type.readParamsMap(buffer, this.params);
        } else {
            throw new Error(
                "NpcType: Opcode " +
                    opcode +
                    " not implemented. ID: " +
                    this.id +
                    ". cache: " +
                    this.cacheInfo,
            );
        }
    }

    override post(): void {
        if (this.footprintSize < 0) {
            this.footprintSize = Math.floor(0.4 * (Math.max(1, this.size) * 128));
        }
    }

    getIdleSeqId(basTypeLoader: BasTypeLoader): number {
        if (this.basTypeId !== -1) {
            return basTypeLoader.load(this.basTypeId).idleSeqId;
        }
        return this.idleSeqId;
    }

    getWalkSeqId(basTypeLoader: BasTypeLoader): number {
        if (this.basTypeId !== -1) {
            return basTypeLoader.load(this.basTypeId).walkSeqId;
        }
        return this.walkSeqId;
    }

    getMovementSeqSet(basTypeLoader: BasTypeLoader): {
        idle: number;
        walk: number;
        walkBack: number;
        walkLeft: number;
        walkRight: number;
        run: number;
        runBack: number;
        runLeft: number;
        runRight: number;
        crawl: number;
        crawlBack: number;
        crawlLeft: number;
        crawlRight: number;
        turnLeft: number;
        turnRight: number;
    } {
        if (this.basTypeId !== -1) {
            const bas = basTypeLoader.load(this.basTypeId);
            return {
                idle: bas.idleSeqId,
                walk: bas.walkSeqId,
                walkBack: bas.walkBackSeqId,
                walkLeft: bas.walkLeftSeqId,
                walkRight: bas.walkRightSeqId,
                run: bas.runSeqId,
                runBack: bas.runBackSeqId,
                runLeft: bas.runLeftSeqId,
                runRight: bas.runRightSeqId,
                crawl: bas.crawlSeqId,
                crawlBack: bas.crawlBackSeqId,
                crawlLeft: bas.crawlLeftSeqId,
                crawlRight: bas.crawlRightSeqId,
                turnLeft: bas.idleLeftSeqId,
                turnRight: bas.idleRightSeqId,
            };
        }

        return {
            idle: this.idleSeqId,
            walk: this.walkSeqId,
            walkBack: this.walkBackSeqId,
            walkLeft: this.walkLeftSeqId,
            walkRight: this.walkRightSeqId,
            run: this.runSeqId,
            runBack: this.runBackSeqId,
            runLeft: this.runLeftSeqId,
            runRight: this.runRightSeqId,
            crawl: this.crawlSeqId,
            crawlBack: this.crawlBackSeqId,
            crawlLeft: this.crawlLeftSeqId,
            crawlRight: this.crawlRightSeqId,
            turnLeft: this.turnLeftSeqId,
            turnRight: this.turnRightSeqId,
        };
    }

    transform(varManager: VarManager, loader: NpcTypeLoader): NpcType | undefined {
        if (!this.transforms) {
            return undefined;
        }

        let transformIndex = -1;
        if (this.transformVarbit !== -1) {
            transformIndex = varManager.getVarbit(this.transformVarbit);
        } else if (this.transformVarp !== -1) {
            transformIndex = varManager.getVarp(this.transformVarp);
        }

        let transformId = this.transforms[this.transforms.length - 1];
        if (transformIndex >= 0 && transformIndex < this.transforms.length - 1) {
            transformId = this.transforms[transformIndex];
        }

        if (transformId === -1) {
            return undefined;
        }
        return loader.load(transformId);
    }
}
