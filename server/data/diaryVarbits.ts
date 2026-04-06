/**
 * Achievement diary varbits applied during player handshake.
 * Unlocks all diary tiers so the diary tab shows completed state.
 */
export const DIARY_VARBITS: Array<[number, number]> = [
    // === STARTED FLAGS (1 = started) ===
    [3576, 1], // Karamja (atjun_started)
    [4448, 1], // Ardougne
    [4449, 1], // Falador
    [4450, 1], // Fremennik
    [4451, 1], // Kandarin
    [4452, 1], // Desert
    [4453, 1], // Lumbridge
    [4454, 1], // Morytania
    [4455, 1], // Varrock
    [4456, 1], // Western
    [4457, 1], // Wilderness
    [7924, 1], // Kourend

    // === COMPLETION FLAGS (1 = complete) ===
    // Ardougne
    [4458, 1],
    [4459, 1],
    [4460, 1],
    [4461, 1],
    // Desert
    [4483, 1],
    [4484, 1],
    [4485, 1],
    [4486, 1],
    // Falador
    [4462, 1],
    [4463, 1],
    [4464, 1],
    [4465, 1],
    // Fremennik
    [4491, 1],
    [4492, 1],
    [4493, 1],
    [4494, 1],
    // Kandarin
    [4475, 1],
    [4476, 1],
    [4477, 1],
    [4478, 1],
    // Karamja (atjun)
    // OSRS CS2 parity: these "done" varbits use value 2 when complete.
    [3578, 2],
    [3599, 2],
    [3611, 2],
    [4566, 1],
    // Kourend
    [7925, 1],
    [7926, 1],
    [7927, 1],
    [7928, 1],
    // Lumbridge
    [4495, 1],
    [4496, 1],
    [4497, 1],
    [4498, 1],
    // Morytania
    [4487, 1],
    [4488, 1],
    [4489, 1],
    [4490, 1],
    // Varrock
    [4479, 1],
    [4480, 1],
    [4481, 1],
    [4482, 1],
    // Western
    [4471, 1],
    [4472, 1],
    [4473, 1],
    [4474, 1],
    // Wilderness
    [4466, 1],
    [4467, 1],
    [4468, 1],
    [4469, 1],

    // === TASK COUNTS (set to max required for each tier) ===
    // Karamja: easy=10, med=19, hard=10, elite=5
    [2423, 10],
    [6288, 19],
    [6289, 10],
    [6290, 5],
    // Ardougne: easy=10, med=12, hard=12, elite=8
    [6291, 10],
    [6292, 12],
    [6293, 12],
    [6294, 8],
    // Desert: easy=11, med=12, hard=10, elite=6
    [6295, 11],
    [6296, 12],
    [6297, 10],
    [6298, 6],
    // Falador: easy=11, med=14, hard=11, elite=6
    [6299, 11],
    [6300, 14],
    [6301, 11],
    [6302, 6],
    // Fremennik: easy=10, med=9, hard=9, elite=6
    [6303, 10],
    [6304, 9],
    [6305, 9],
    [6306, 6],
    // Kandarin: easy=11, med=14, hard=11, elite=7
    [6307, 11],
    [6308, 14],
    [6309, 11],
    [6310, 7],
    // Lumbridge: easy=12, med=12, hard=11, elite=6
    [6311, 12],
    [6312, 12],
    [6313, 11],
    [6314, 6],
    // Morytania: easy=11, med=11, hard=10, elite=6
    [6315, 11],
    [6316, 11],
    [6317, 10],
    [6318, 6],
    // Varrock: easy=14, med=13, hard=10, elite=5
    [6319, 14],
    [6320, 13],
    [6321, 10],
    [6322, 5],
    // Wilderness: easy=12, med=11, hard=10, elite=7
    [6323, 12],
    [6324, 11],
    [6325, 10],
    [6326, 7],
    // Western: easy=11, med=13, hard=13, elite=7
    [6327, 11],
    [6328, 13],
    [6329, 13],
    [6330, 7],
    // Kourend: easy=12, med=13, hard=10, elite=8
    [7933, 12],
    [7934, 13],
    [7935, 10],
    [7936, 8],

    // === REWARD FLAGS (1 = claimed) ===
    // Karamja: easy=3577, med=3598, hard=3610, elite=4567
    [3577, 1],
    [3598, 1],
    [3610, 1],
    [4567, 1],
    // Ardougne: easy=4499, med=4500, hard=4501, elite=4502
    [4499, 1],
    [4500, 1],
    [4501, 1],
    [4502, 1],
    // Falador: easy=4503, med=4504, hard=4505, elite=4506
    [4503, 1],
    [4504, 1],
    [4505, 1],
    [4506, 1],
    // Wilderness: easy=4507, med=4508, hard=4509, elite=4510
    [4507, 1],
    [4508, 1],
    [4509, 1],
    [4510, 1],
    // Western: easy=4511, med=4512, hard=4513, elite=4514
    [4511, 1],
    [4512, 1],
    [4513, 1],
    [4514, 1],
    // Kandarin: easy=4515, med=4516, hard=4517, elite=4518
    [4515, 1],
    [4516, 1],
    [4517, 1],
    [4518, 1],
    // Varrock: easy=4519, med=4520, hard=4521, elite=4522
    [4519, 1],
    [4520, 1],
    [4521, 1],
    [4522, 1],
    // Desert: easy=4523, med=4524, hard=4525, elite=4526
    [4523, 1],
    [4524, 1],
    [4525, 1],
    [4526, 1],
    // Morytania: easy=4527, med=4528, hard=4529, elite=4530
    [4527, 1],
    [4528, 1],
    [4529, 1],
    [4530, 1],
    // Fremennik: easy=4531, med=4532, hard=4533, elite=4534
    [4531, 1],
    [4532, 1],
    [4533, 1],
    [4534, 1],
    // Lumbridge: easy=4535, med=4536, hard=4537, elite=4538
    [4535, 1],
    [4536, 1],
    [4537, 1],
    [4538, 1],
    // Kourend: easy=7929, med=7930, hard=7931, elite=7932
    [7929, 1],
    [7930, 1],
    [7931, 1],
    [7932, 1],
];
