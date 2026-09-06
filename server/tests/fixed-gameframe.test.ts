import assert from "node:assert/strict";
import { ArchiveEnumTypeLoader } from "../../client/rs/config/enumtype/EnumTypeLoader";
import { initCacheEnv } from "../src/world/CacheEnv";
import { ViewportEnumService } from "../src/widgets/viewport/ViewportEnumService";
import { DisplayMode, getDesktopInterfaces, getInventoryTabUid, getMainmodalUid,
    getSidemodalUid, getViewportTrackerFrontUid, setViewportEnumService } from "../src/widgets/viewport";
import { getOrbsMountUid } from "../src/widgets/minimapOrbs";
const env = initCacheEnv("caches");
const loader = new ArchiveEnumTypeLoader(env.info, env.indices.configs.getArchive(8));
const fixed = loader.load(1129);
const mapped = new Map(fixed.keys.map((key, i) => [key, fixed.intValues[i]]));
setViewportEnumService(new ViewportEnumService(loader));
const mounts = getDesktopInterfaces(DisplayMode.FIXED);
assert.equal(new Set(mounts.map((mount) => mount.targetUid)).size, mounts.length, "fixed HUD interfaces cannot overwrite each other");
for (const [group, baseChild] of [[593, 76], [320, 77], [149, 79], [116, 87], [162, 96], [163, 9], [651, 6]]) {
    assert.equal(mounts.find((mount) => mount.groupId === group)?.targetUid, mapped.get((161 << 16) | baseChild));
}
assert.equal(getMainmodalUid(DisplayMode.FIXED), mapped.get((161 << 16) | 16));
assert.equal(getSidemodalUid(DisplayMode.FIXED), mapped.get((161 << 16) | 74));
assert.equal(getInventoryTabUid(DisplayMode.FIXED), mapped.get((161 << 16) | 79));
assert.equal(getViewportTrackerFrontUid(DisplayMode.FIXED), mapped.get((161 << 16) | 17));
assert.equal(getOrbsMountUid(DisplayMode.FIXED), mapped.get((161 << 16) | 33));
assert.notEqual(getOrbsMountUid(DisplayMode.FIXED), mounts.find((mount) => mount.groupId === 162)?.targetUid);
assert.equal(getDesktopInterfaces(DisplayMode.RESIZABLE_NORMAL).find((mount) => mount.groupId === 149)?.targetUid, (161 << 16) | 79);
assert.equal(getInventoryTabUid(DisplayMode.MOBILE) >>> 16, 601);
console.log("fixed gameframe mounts match original cache enums; resizable and mobile mounts preserved");
