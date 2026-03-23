/**
 * Parses CS2 script 1705 (world map intermap links) into a JSON lookup table.
 *
 * Script 1705 maps source coordinates to destination coordinates for all
 * loc-based traversals: ladders, stairs, trapdoors, dungeon entrances, etc.
 *
 * Coordinate format in the CS2: plane_regionX_regionY_localX_localY
 * Absolute world coords:  x = regionX * 64 + localX,  y = regionY * 64 + localY
 *
 * Output: server/data/intermap-links.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPT_PATH = path.resolve(
    __dirname,
    "../../references/cs2-scripts/scripts/[proc,script1705].cs2",
);
const OUTPUT_PATH = path.resolve(
    __dirname,
    "../../server/data/intermap-links.json",
);

interface Coord {
    x: number;
    y: number;
    level: number;
}

interface IntermapLink {
    from: Coord;
    to: Coord;
}

function parseCoord(raw: string): Coord {
    // Format: plane_regionX_regionY_localX_localY
    const parts = raw.split("_").map(Number);
    if (parts.length !== 5 || parts.some(isNaN)) {
        throw new Error(`Invalid coord format: "${raw}"`);
    }
    const [level, regionX, regionY, localX, localY] = parts;
    return {
        x: regionX * 64 + localX,
        y: regionY * 64 + localY,
        level,
    };
}

function main(): void {
    const source = fs.readFileSync(SCRIPT_PATH, "utf-8");
    const lines = source.split("\n");

    const links: IntermapLink[] = [];
    let currentCase: string | null = null;

    for (const line of lines) {
        const trimmed = line.trim();

        // Match: case 0_39_54_16_52 :
        const caseMatch = trimmed.match(
            /^case\s+(\d+_\d+_\d+_\d+_\d+)\s*:$/,
        );
        if (caseMatch) {
            currentCase = caseMatch[1];
            continue;
        }

        // Match: ~script1706(0_27_83_36_55);
        const destMatch = trimmed.match(
            /^~script1706\((\d+_\d+_\d+_\d+_\d+)\);$/,
        );
        if (destMatch && currentCase) {
            const from = parseCoord(currentCase);
            const to = parseCoord(destMatch[1]);
            links.push({ from, to });
            currentCase = null;
            continue;
        }

        // Reset on default / non-matching lines
        if (trimmed === "case default :") {
            currentCase = null;
        }
    }

    // Build a keyed object for fast lookup: "x,y,level" -> destination
    const lookup: Record<string, Coord> = {};
    for (const link of links) {
        const key = `${link.from.x},${link.from.y},${link.from.level}`;
        lookup[key] = link.to;
    }

    const output = {
        _comment:
            "Auto-generated from CS2 script 1705 (world map intermap links). Maps source tile coords to destination tile coords for loc traversals (ladders, stairs, trapdoors, dungeon entrances, etc.).",
        _format: "Keys are 'x,y,level'. Values are destination {x, y, level}.",
        _totalLinks: links.length,
        links: lookup,
    };

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");

    console.log(
        `Parsed ${links.length} intermap links -> ${OUTPUT_PATH}`,
    );
}

main();
