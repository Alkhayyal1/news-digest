export async function readFile(p) { const r = await fetch('/public/' + String(p).split('/public/').pop()); if (!r.ok) throw new Error('ENOENT'); return new Uint8Array(await r.arrayBuffer()); }
