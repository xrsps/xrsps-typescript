// Derived from references/230.1 anims.json and animation_names.txt
// Maps canonical emote sequence names to SeqType IDs for this cache family.
// Canonical names use the "emote_*" naming seen in references.

export const EMOTE_NAME_TO_SEQ: Record<string, number> = {
    emote_yes: 855,
    emote_no: 856,
    emote_think: 857,
    emote_bow: 858,
    emote_angry: 859,
    emote_cry: 860,
    emote_laugh: 861,
    emote_cheer: 862,
    emote_wave: 863,
    emote_beckon: 864,
    emote_clap: 865,
    emote_dance: 866,
    emote_run_on_spot: 868,
    emote_starjump_5: 870,
    emote_pushups_5: 872,
    emote_situps_5: 874,
    emote_glass_wall: 1128,
    emote_mime_lean: 1129,
    emote_climbing_rope: 1130,
    emote_glass_box: 1131,
    emote_blow_kiss: 1374,
    emote_panic: 2105,
    emote_dance_scottish: 2106,
    emote_dance_spin: 2107,
    emote_dance_headbang: 2108,
    emote_jump_with_joy: 2109,
    emote_ya_boo_sucks: 2110,
    emote_yawn: 2111,
    emote_fremmenik_salute: 2112,
    emote_shrug: 2113,
    terrified_emote: 2836,
    zombie_walk_emote: 3544,
    emote_slap_head: 4275,
    emote_lightbulb: 4276,
    emote_stampfeet: 4278,
    emote_panic_flap: 4280,
    emote_air_guitar: 4751,
    trail_bow_emote: 5312,
    trail_yawn_emote: 5313,
    trail_angry_emote: 5315,
    trail_dance_emote: 5316,
    peng_emote_bow: 5693,
    peng_emote_spin: 5694,
    peng_emote_wave: 5695,
    peng_emote_cheer: 5696,
    peng_emote_shiver: 5697,
    peng_emote_clap: 5698,
    peng_emote_flap: 5699,
    peng_emote_preen: 5700,
    rabbit_emote: 6111,
    ash_emote: 7131,
    emote_uri_briefcase: 7278,
    emote_uri_invisible: 7279,
    premier_club_emote: 7751,
    easter19_egg_emote: 8331,
    league_trophy_emote_small: 8536,
    league_trophy_emote_large: 8537,
    emote_explore: 8541,
    trailblazer_league_area_unlock_emote: 8792,
    emote_flex: 8917,
    league03_area_unlock_emote_player: 9208,
    emote_trick_or_treat_0: 9831,
    emote_trick_or_treat_1: 9832,
    emote_trick_or_treat_2: 9833,
    emote_trick_or_treat_3: 9834,
    emote_trick_or_treat_4: 9835,
    emote_party: 10031,
    emote_dance_loop: 10048,
    emote_dance_scottish_loop: 10049,
    emote_dance_headbang_loop: 10050,
    human_emote_crabdance: 10051,
    human_emote_crabdance_loop: 10052,
    emote_sit: 10053,
    emote_sit_loop: 10061,
    emote_mime_lean_loop: 10062,
    emote_trick: 10503,
    emote_yawn_short: 10678,
    terrified_emote_long: 10781,
    emote_varlamore_salute: 10796,
    emote_varlamore_salute_loop: 10797,
    emote_bow_walkmerge: 11526,
    emote_panic_loop: 12050,
    emote_jump_with_joy_loop: 12051,
    emote_ya_boo_sucks_loop: 12052,
    emote_yawn_loop: 12053,
    emote_yawn_short_loop: 12054,
    emote_fremmenik_salute_loop: 12055,
    emote_shrug_loop: 12056,
};

// Map UI display names to canonical names
const NAME_TO_CANON: Record<string, string> = {
    yes: "emote_yes",
    no: "emote_no",
    bow: "emote_bow",
    angry: "emote_angry",
    think: "emote_think",
    wave: "emote_wave",
    shrug: "emote_shrug",
    cheer: "emote_cheer",
    beckon: "emote_beckon",
    laugh: "emote_laugh",
    "jump for joy": "emote_jump_with_joy",
    yawn: "emote_yawn",
    dance: "emote_dance",
    jig: "emote_dance_scottish",
    spin: "emote_dance_spin",
    headbang: "emote_dance_headbang",
    cry: "emote_cry",
    "blow kiss": "emote_blow_kiss",
    panic: "emote_panic",
    raspberry: "emote_ya_boo_sucks",
    clap: "emote_clap",
    salute: "emote_fremmenik_salute",
    "glass box": "emote_glass_box",
    "climb rope": "emote_climbing_rope",
    lean: "emote_mime_lean",
    "glass wall": "emote_glass_wall",
    idea: "emote_lightbulb",
    stomp: "emote_stampfeet",
    flap: "peng_emote_flap",
    "slap head": "emote_slap_head",
    "zombie walk": "zombie_walk_emote",
    scared: "terrified_emote",
    "rabbit hop": "rabbit_emote",
    explore: "emote_explore",
    trick: "emote_trick",
    sit: "emote_sit",
    flex: "emote_flex",
    party: "emote_party",
    "air guitar": "emote_air_guitar",
};

export function resolveSeqForEmoteDisplayName(name: string): number | undefined {
    if (!name) return undefined;
    const key = name.trim().toLowerCase();
    const canon = NAME_TO_CANON[key];
    if (canon) return EMOTE_NAME_TO_SEQ[canon];
    // Loose heuristics
    // Do not guess Goblin emotes; server/client mapping handles them explicitly.
    if (key.includes("yawn")) return EMOTE_NAME_TO_SEQ["emote_yawn"];
    if (key.includes("spin")) return EMOTE_NAME_TO_SEQ["emote_dance_spin"];
    if (key.includes("jig")) return EMOTE_NAME_TO_SEQ["emote_dance_scottish"];
    if (key.includes("headbang")) return EMOTE_NAME_TO_SEQ["emote_dance_headbang"];
    if (key.includes("glass") && key.includes("box")) return EMOTE_NAME_TO_SEQ["emote_glass_box"];
    if (key.includes("glass") && key.includes("wall")) return EMOTE_NAME_TO_SEQ["emote_glass_wall"];
    if (key.includes("climb") && key.includes("rope"))
        return EMOTE_NAME_TO_SEQ["emote_climbing_rope"];
    if (key.includes("lean")) return EMOTE_NAME_TO_SEQ["emote_mime_lean"];
    if (key.includes("kiss")) return EMOTE_NAME_TO_SEQ["emote_blow_kiss"];
    if (key.includes("panic")) return EMOTE_NAME_TO_SEQ["emote_panic"];
    if (key.includes("salute")) return EMOTE_NAME_TO_SEQ["emote_fremmenik_salute"];
    if (key.includes("rabbit")) return EMOTE_NAME_TO_SEQ["rabbit_emote"];
    if (key.includes("explore")) return EMOTE_NAME_TO_SEQ["emote_explore"];
    if (key.includes("trick")) return EMOTE_NAME_TO_SEQ["emote_trick"];
    if (key.includes("air") && key.includes("guitar")) return EMOTE_NAME_TO_SEQ["emote_air_guitar"];
    if (key.includes("zombie") && key.includes("walk"))
        return EMOTE_NAME_TO_SEQ["zombie_walk_emote"];
    return undefined;
}
