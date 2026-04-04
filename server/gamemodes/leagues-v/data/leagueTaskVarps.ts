/**
 * League task completion bitfield varps.
 *
 * OSRS parity: CS2 uses `group = taskId / 32` and reads a varp that contains 32 completion bits.
 * These varps are not contiguous in the cache and are split across several ranges.
 */
export const LEAGUE_TASK_COMPLETION_VARPS: ReadonlyArray<number> = Object.freeze([
    // Groups 0-15 → varps 2616-2631
    2616, 2617, 2618, 2619, 2620, 2621, 2622, 2623, 2624, 2625, 2626, 2627, 2628, 2629, 2630, 2631,
    // Groups 16-43 → varps 2808-2835
    2808, 2809, 2810, 2811, 2812, 2813, 2814, 2815, 2816, 2817, 2818, 2819, 2820, 2821, 2822, 2823,
    2824, 2825, 2826, 2827, 2828, 2829, 2830, 2831, 2832, 2833, 2834, 2835,
    // Groups 44-47 → varps 3339-3342
    3339, 3340, 3341, 3342,
    // Groups 48-61 → varps 4036-4049
    4036, 4037, 4038, 4039, 4040, 4041, 4042, 4043, 4044, 4045, 4046, 4047, 4048, 4049,
]);
