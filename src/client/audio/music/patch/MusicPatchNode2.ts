// Parsed instrument envelope + sample mapping for one note
export class MusicPatchNode2 {
    volumeEnvelope?: Uint8Array;
    releaseEnvelope?: Uint8Array;
    decayRate: number = 0;
    volumeEnvelopeRate: number = 0;
    releaseEnvelopeRate: number = 0;
    decayModifier: number = 0;
    vibratoDepth: number = 0;
    vibratoRate: number = 0;
    vibratoDelay: number = 0;
}
