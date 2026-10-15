// Ejecuta los tests del navegador en Node con un document mínimo
const els=[]; const mk=()=>({className:'',textContent:'',appendChild:c=>els.push(c)});
globalThis.document={getElementById:()=>mk(),createElement:()=>{const e=mk();els.push(e);return e}};
for (const f of process.argv.slice(2)) await import(f);
const fails=els.filter(e=>e.className?.includes('fail')); const oks=els.filter(e=>e.className?.includes('pass'));
console.log(`pasaron ${oks.length} · fallaron ${fails.length}`); fails.forEach(f=>console.log(f.textContent));
