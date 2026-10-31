// Corre el pipeline contra un directorio de fuentes ya descargado.
// uso: node scripts/run-local.js <fuentes/> <output/> [--fresh]
import { runPipeline } from '../src/pipeline.js';

const [src = 'raw/full', out = 'output'] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const fresh = process.argv.includes('--fresh');
runPipeline({ srcDir: src, outDir: out, storedFile: fresh ? null : 'data/pseudonyms.json', log: console.log });
