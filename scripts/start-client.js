process.env.BROWSERSLIST_IGNORE_OLD_DATA = "true";
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.BABEL_ENV = process.env.BABEL_ENV || "development";

const originalEmitWarning = process.emitWarning.bind(process);

process.emitWarning = (warning, ...args) => {
    const code =
        typeof warning === "object" && warning !== null
            ? warning.code
            : typeof args[1] === "string"
              ? args[1]
              : undefined;

    if (code === "DEP0176") {
        return;
    }

    return originalEmitWarning(warning, ...args);
};

require("@craco/craco/dist/scripts/start");
