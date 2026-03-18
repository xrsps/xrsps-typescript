import { resolveFogRange, resolveNextEffectiveRenderDistanceTiles } from "./RenderDistancePolicy";

describe("RenderDistancePolicy", () => {
    test("touch movement alone does not shrink fog range when zoom is unchanged", () => {
        const baseRenderDistance = 25;
        let effectiveRenderDistance = baseRenderDistance;

        for (let i = 0; i < 32; i++) {
            effectiveRenderDistance = resolveNextEffectiveRenderDistanceTiles({
                baseRenderDistance,
                currentEffectiveRenderDistance: effectiveRenderDistance,
                isTouchDevice: true,
                mobilePressure: 0,
                triangles: 0,
                batches: 0,
            });
        }

        const stationaryFog = resolveFogRange({
            renderDistance: baseRenderDistance,
            autoFogDepth: true,
            autoFogDepthFactor: 0.7,
            manualFogDepth: 24,
        });
        const movingFog = resolveFogRange({
            renderDistance: effectiveRenderDistance,
            autoFogDepth: true,
            autoFogDepthFactor: 0.7,
            manualFogDepth: 24,
        });

        expect(effectiveRenderDistance).toBe(25);
        expect(stationaryFog).toEqual({ fogEnd: 25, fogDepth: 17.5 });
        expect(movingFog).toEqual({ fogEnd: 25, fogDepth: 17.5 });
    });

    test("desktop movement keeps the same fog range", () => {
        const effectiveRenderDistance = resolveNextEffectiveRenderDistanceTiles({
            baseRenderDistance: 25,
            currentEffectiveRenderDistance: 25,
            isTouchDevice: false,
            mobilePressure: 0,
            triangles: 0,
            batches: 0,
        });

        const fog = resolveFogRange({
            renderDistance: effectiveRenderDistance,
            autoFogDepth: true,
            autoFogDepthFactor: 0.7,
            manualFogDepth: 24,
        });

        expect(effectiveRenderDistance).toBe(25);
        expect(fog).toEqual({ fogEnd: 25, fogDepth: 17.5 });
    });

    test("touch pressure can still reduce fog range", () => {
        let effectiveRenderDistance = 25;

        for (let i = 0; i < 32; i++) {
            effectiveRenderDistance = resolveNextEffectiveRenderDistanceTiles({
                baseRenderDistance: 25,
                currentEffectiveRenderDistance: effectiveRenderDistance,
                isTouchDevice: true,
                mobilePressure: 2,
                triangles: 1_400_000,
                batches: 1_250,
            });
        }

        const fog = resolveFogRange({
            renderDistance: effectiveRenderDistance,
            autoFogDepth: true,
            autoFogDepthFactor: 0.7,
            manualFogDepth: 24,
        });

        expect(effectiveRenderDistance).toBe(8);
        expect(fog).toEqual({ fogEnd: 8, fogDepth: 5.6 });
    });
});
