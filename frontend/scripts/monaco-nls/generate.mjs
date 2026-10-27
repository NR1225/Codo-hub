// Monaco-ның қазақша аудармасын жасайды.
// Monaco хабарламаларды реттік нөмір бойынша іздейді (globalThis._VSCODE_NLS_MESSAGES[i]),
// ал нөмірлер нұсқа сайын өзгереді. Сондықтан сөздік ағылшын мәтіні бойынша жазылады да,
// осы скрипт оны орнатылған monaco-editor нұсқасының нөмірлеріне айналдырады.
//   node scripts/monaco-nls/generate.mjs   (monaco-editor жаңартылғаннан кейін қайта іске қосыңыз)
import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const pkg = JSON.parse(readFileSync(resolve(root, 'node_modules/monaco-editor/package.json'), 'utf8'));

const sandbox = { globalThis: {} };
runInNewContext(readFileSync(resolve(root, 'node_modules/monaco-editor/esm/nls.messages.js'), 'utf8'), sandbox);
const english = sandbox.globalThis._VSCODE_NLS_MESSAGES;

const dict = JSON.parse(readFileSync(resolve(here, 'kk.dict.json'), 'utf8'));
const messages = {};
const missing = [];
for (const [en, kk] of Object.entries(dict)) {
  let found = false;
  english.forEach((text, i) => {
    if (text === en) {
      messages[i] = kk;
      found = true;
    }
  });
  if (!found) missing.push(en);
}

const out = resolve(root, 'src/components/vibecoding/monacoNls.kk.json');
writeFileSync(out, `${JSON.stringify({ monacoVersion: pkg.version, messages }, null, 0)}\n`);
console.log(`monaco-editor ${pkg.version}: ${Object.keys(messages).length} жол аударылды → ${out}`);
if (missing.length) console.warn(`Табылмады (${missing.length}):\n  ${missing.join('\n  ')}`);
