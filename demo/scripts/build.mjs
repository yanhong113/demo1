import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
const assets={};
for(const name of readdirSync('web')) {
  const types={html:'text/html;charset=utf-8',css:'text/css;charset=utf-8',js:'text/javascript;charset=utf-8'};
  const type=types[name.split('.').pop()];
  if(type) assets['/'+name]={body:readFileSync('web/'+name,'utf8'),type};
}
writeFileSync('server/assets.mjs','export const assets='+JSON.stringify(assets)+';\n');
mkdirSync('dist/server',{recursive:true});
let code=readFileSync('server/worker.mjs','utf8');
code=code.replace("import {initialState,fail,text,employeeId,integer,requireRole,expireAuctions,mutate,publicState} from './core.mjs';",readFileSync('server/core.mjs','utf8').replaceAll('export ',''));
code=code.replace("import {assets} from './assets.mjs';",readFileSync('server/assets.mjs','utf8').replace('export ',''));
writeFileSync('dist/server/index.js',code);
console.log('Built Worker and embedded web assets');
