const { when, whenDev, addBeforeLoader, loaderByName } = require("@craco/craco");
const fs = require("fs");
const path = require("path");

const JsonMinimizerPlugin = require("json-minimizer-webpack-plugin");
const evalSourceMapMiddleware = require("react-dev-utils/evalSourceMapMiddleware");
const noopServiceWorkerMiddleware = require("react-dev-utils/noopServiceWorkerMiddleware");
const redirectServedPath = require("react-dev-utils/redirectServedPathMiddleware");
const paths = require("react-scripts/config/paths");

const express = require("express");

module.exports = {
    webpack: {
        configure: (webpackConfig) => {
            const jsXxhashPath = path.resolve(__dirname, "node_modules/js-xxhash");
            const glslLoader = {
                test: /\.(glsl|vs|fs)$/,
                loader: "ts-shader-loader",
            };

            // Kind of a hack to get the glsl loader to work
            // https://github.com/dilanx/craco/issues/486
            for (const rule of webpackConfig.module.rules) {
                if (
                    rule &&
                    rule.enforce === "pre" &&
                    Array.isArray(rule.use) &&
                    rule.use.some((use) =>
                        typeof use === "object"
                            ? use.loader?.includes("source-map-loader")
                            : String(use).includes("source-map-loader"),
                    )
                ) {
                    const existingExclude = rule.exclude;
                    rule.exclude = Array.isArray(existingExclude)
                        ? [...existingExclude, jsXxhashPath]
                        : existingExclude
                          ? [existingExclude, jsXxhashPath]
                          : [jsXxhashPath];
                }
                if (rule.oneOf) {
                    rule.oneOf.unshift(glslLoader);
                    break;
                }
            }

            webpackConfig.module.rules.push({
                resourceQuery: /url/,
                type: "asset/resource",
            });
            webpackConfig.module.rules.push({
                resourceQuery: /source/,
                type: "asset/source",
            });

            // addBeforeLoader(webpackConfig, loaderByName('file-loader'), glslLoader);

            webpackConfig.resolve.fallback = {
                fs: false,
            };

            webpackConfig.resolve.extensions = [".web.js", ...webpackConfig.resolve.extensions];

            webpackConfig.optimization.minimizer.push(new JsonMinimizerPlugin());
            webpackConfig.ignoreWarnings = [
                ...(webpackConfig.ignoreWarnings ?? []),
                (warning) =>
                    typeof warning?.message === "string" &&
                    warning.message.includes("Failed to parse source map") &&
                    typeof warning?.module?.resource === "string" &&
                    warning.module.resource.includes(`${path.sep}node_modules${path.sep}js-xxhash${path.sep}`),
            ];

            return webpackConfig;
        },
    },
    devServer: (devServerConfig) => {
        delete devServerConfig.onBeforeSetupMiddleware;
        delete devServerConfig.onAfterSetupMiddleware;

        return {
            ...devServerConfig,
            hot: false,
            liveReload: false,
            headers: {
                "Cross-Origin-Opener-Policy": "same-origin",
                "Cross-Origin-Embedder-Policy": "require-corp",
            },
            client: {
                ...devServerConfig.client,
                overlay: {
                    ...devServerConfig.client?.overlay,
                    errors: true,
                    warnings: false,
                    runtimeErrors: (error) => {
                        if (error instanceof DOMException && error.name === "AbortError") {
                            return false;
                        }
                        return true;
                    },
                },
            },
            setupMiddlewares: (middlewares, devServer) => {
                if (!devServer) {
                    throw new Error("webpack-dev-server is not defined");
                }

                devServer.app.use(evalSourceMapMiddleware(devServer));

                if (fs.existsSync(paths.proxySetup)) {
                    require(paths.proxySetup)(devServer.app);
                }

                devServer.app.use(redirectServedPath(paths.publicUrlOrPath));
                devServer.app.use(noopServiceWorkerMiddleware(paths.publicUrlOrPath));
                devServer.app.use("/caches", express.static("caches"));

                return middlewares;
            },
        };
    },
};
