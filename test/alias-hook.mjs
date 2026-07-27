// Resolves the project's "@/..." import alias (jsconfig.json paths) for plain
// node test runs. Next.js handles this itself at build time.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) {
      return nextResolve(specifier, context);
    }

    let target = path.join(root, specifier.slice(2));
    if (!path.extname(target) && existsSync(`${target}.js`)) {
      target = `${target}.js`;
    }

    return nextResolve(pathToFileURL(target).href, context);
  },
});
