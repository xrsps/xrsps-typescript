/**
 * Bot-SDK public exports. Importers should only touch these names —
 * internal files (codec, perception builder, etc.) are implementation
 * details subject to churn.
 */

export { BotSdkServer, type BotSdkServerOptions, type BotSdkServerDeps } from "./BotSdkServer";
export { BotSdkActionRouter, type ActionDispatchResult } from "./BotSdkActionRouter";
export { AgentPlayerFactory, type AgentSpawnRequest, type AgentSpawnResult } from "./AgentPlayerFactory";
export { decodeClientFrame, encodeServerFrame } from "./BotSdkCodec";
export type { ClientFrame, ServerFrame, SpawnFrame, WalkToAction } from "./BotSdkProtocol";
