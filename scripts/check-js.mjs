import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const root = process.cwd();
const htmlPath = resolve(root, "index.html");
const html = readFileSync(htmlPath, "utf8");
const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const chunks = [];
const errors = [];

if (!tags.length) errors.push("Aucun script trouvé dans index.html.");

for (let i = 0; i < tags.length; i++) {
  const [, attrs, inline] = tags[i];
  const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
  if (srcMatch) {
    const src = srcMatch[1];
    if (/^https?:\/\//i.test(src)) continue;
    const localPath = src.split("?")[0].split("#")[0];
    const fullPath = resolve(root, localPath);
    if (!existsSync(fullPath)) {
      errors.push(`Script local introuvable : ${src}`);
      continue;
    }
    chunks.push({ name: src, code: readFileSync(fullPath, "utf8") });
  } else if (inline.trim()) {
    chunks.push({ name: `index.html script inline #${i + 1}`, code: inline });
  }
}

for (const chunk of chunks) {
  try {
    new vm.Script(chunk.code, { filename: chunk.name });
    console.log(`OK syntaxe : ${chunk.name}`);
  } catch (error) {
    errors.push(`Erreur de syntaxe dans ${chunk.name}: ${error.message}`);
  }
}

// Browser classic scripts share a global lexical scope. Compile them together
// to catch duplicate top-level const/let declarations across script tags.
try {
  new vm.Script(chunks.map((chunk) => `\n/* ${chunk.name.replace(/\*\//g, "* /")} */\n${chunk.code}`).join("\n;\n"), {
    filename: "MOUSSE combined browser scripts"
  });
  console.log("OK : aucun conflit lexical entre les scripts chargés ensemble.");
} catch (error) {
  errors.push(`Conflit entre scripts chargés ensemble : ${error.message}`);
}

const liveTag = html.indexOf('src="assets/mousse-live.js');
if (liveTag < 0) errors.push("Le script assets/mousse-live.js n'est pas référencé.");
else if (!html.slice(0, liveTag).includes("function renderCart()")) {
  errors.push("renderCart doit être défini dans index.html avant mousse-live.js.");
}

if (errors.length) {
  console.error("\nÉCHEC des contrôles MOUSSE :");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("\nTous les contrôles statiques MOUSSE sont réussis.");
}
