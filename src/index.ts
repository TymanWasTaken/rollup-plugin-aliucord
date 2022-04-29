import { spawn, execSync, SpawnOptionsWithoutStdio } from "child_process";
import { InputOptions, OutputOptions, Plugin } from "rollup";
import swc from "rollup-plugin-swc";
import { hermes } from "rollup-plugin-hermes";
import { cwd } from "process";

function spawnAsync(command: string, args?: ReadonlyArray<string>, options?: SpawnOptionsWithoutStdio): Promise<number | null> {
    return new Promise<number | null>((resolve, reject) => {
        const process = spawn(command, args, options);

        process.once("close", (code) => {
            return resolve(code);
        });
    });
}

function autoDeploy(pushOnly: boolean, isPlugin: boolean): Plugin {
    return {
        name: "AutoDeploy",
        async writeBundle(options, bundle) {
            if (await spawnAsync("adb", ["push", options.file!! + ".bundle", "/sdcard/AliucordRN/" + (isPlugin ? "plugins/" : "")], {
                cwd: cwd()
            }) != 0) {
                console.error("Failed to push");
                return;
            }

            if (!pushOnly) {
                if (await spawnAsync("adb", ["shell", "am", "start", "-S", "-n", "com.discordrn/.MainActivity"]) != 0) {
                    console.error("Failed to start");
                    return;
                }
            }

            console.log("Deployed");
        }
    };
}

interface CommonOptions {
    hermesPath?: string;
    autoDeploy?: boolean | "push-only";
}

function commonOptions(options: InputOptions, pluginOptions: CommonOptions | undefined, isPlugin: boolean) {
    let hash: string;
    try {
        hash = execSync("git rev-parse --short HEAD").toString().replace(/\s*/g, "");
    } catch {
        hash = "unknown";
    }

    options.plugins ??= [];
    options.plugins.push(
        swc({
            jsc: {
                parser: {
                    syntax: "typescript",
                    tsx: true
                },
                minify: {},
                target: "es2015",
                transform: {
                    constModules: {
                        globals: {
                            "aliucord-version": {
                                "sha": `"${hash}"`
                            },
                        }
                    }
                }
            },
            env: {
                // Adapted from https://github.com/facebook/metro/blob/main/packages/metro-react-native-babel-preset/src/configs/main.js
                include: ["transform-block-scoping", "proposal-class-properties", "transform-classes", "transform-destructuring", "transform-async-to-generator"],
                // Workaround swc setting defaults from browserlist
                exclude: ["bugfix/transform-edge-default-parameters", "bugfix/transform-async-arrows-in-class", "bugfix/transform-tagged-template-caching", "bugfix/transform-safari-id-destructuring-collision-in-function-expression", "proposal-class-static-block", "proposal-private-property-in-object", "proposal-logical-assignment-operators", "proposal-export-namespace-from", "proposal-nullish-coalescing-operator", "proposal-optional-chaining", "proposal-optional-catch-binding", "proposal-object-rest-spread", "transform-exponentiation-operator", "transform-block-scoped-functions", "transform-template-literals", "transform-spread", "transform-function-name", "transform-arrow-functions", "transform-duplicate-keys", "transform-sticky-regex", "transform-typeof-symbol", "transform-shorthand-properties", "transform-parameters", "transform-for-of", "transform-computed-properties", "transform-regenerator", "transform-new-target", "transform-property-literals", "transform-member-expression-literals", "transform-reserved-words"]
            },
            sourceMaps: true
        })
    );
    options.plugins.push(hermes(pluginOptions?.hermesPath !== undefined ? { hermesPath: pluginOptions.hermesPath } : undefined));
    if (pluginOptions?.autoDeploy) options.plugins.push(autoDeploy(pluginOptions.autoDeploy === "push-only", isPlugin));

    return options;
}

export function aliucord(pluginOptions?: CommonOptions): Plugin {
    return {
        name: "AliucordPlugin",

        options(options: InputOptions) {
            return commonOptions(options, pluginOptions, false);
        },
    };
}

export function aliucordPlugin(pluginOptions?: CommonOptions): Plugin {
    return {
        name: "AliucordPlugin",
        footer: "window.aliu.api.PluginManager._register(__ACP);delete window.__ACP",

        options(options: InputOptions) {
            options.external = /^(aliucord(\/.+)?|react(-native)?)$/;
            return commonOptions(options, pluginOptions, true);
        },

        outputOptions(options: OutputOptions) {
            options.name = "__ACP";
            options.format = "iife";
            options.globals = (name: string) => {
                switch (name) {
                    case "aliucord":
                        return "window.aliu";
                    case "react":
                        return "window.aliu.metro.React";
                    case "react-native":
                        return "window.aliu.metro.ReactNative";
                }

                if (name.startsWith("aliucord")) return `window.aliu.${name.slice(9).replace("/", ".")}`;

                return name;
            };

            return options;
        }
    };
}
