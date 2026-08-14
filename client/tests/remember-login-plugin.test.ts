import assert from "node:assert/strict";

import { RememberLoginPlugin } from "../game/plugins/rememberlogin/RememberLoginPlugin";
import type { RememberLoginPluginConfig } from "../game/plugins/rememberlogin/types";

let saved: RememberLoginPluginConfig | undefined;
const plugin = new RememberLoginPlugin({
    load: () => ({ enabled: true, username: "Toby", password: "hunter2" }),
    save: (config) => {
        saved = config;
    },
});
const login = { username: "", password: "", currentLoginField: 0 };

plugin.restore(login);
assert.deepEqual(login, { username: "Toby", password: "hunter2", currentLoginField: 1 });

plugin.remember("Other", "new-password");
assert.equal(saved?.username, "Other");
assert.equal(saved?.password, "new-password");

plugin.setConfig({ enabled: false });
login.username = "cleared";
login.password = "cleared";
plugin.restore(login);
assert.equal(login.username, "cleared");
assert.equal(login.password, "cleared");

plugin.setEnabled(false);
assert.equal(saved?.username, "");
assert.equal(saved?.password, "");

const disabledByDefault = new RememberLoginPlugin();
assert.equal(disabledByDefault.getConfig().enabled, false);

console.log("Remember Login plugin tests passed");
