import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import worker from '../server/worker.mjs';
mkdirSync('outputs',{recursive:true});
const sqlite=new DatabaseSync('outputs/preview.sqlite');
const found=sqlite.prepare("SELECT name FROM sqlite_master WHERE name='platform_state'").get();
if(!found)sqlite.exec(readFileSync('drizzle/0000_platform.sql','utf8'));
const DB={prepare(sql){let args=[];const query={bind(...values){args=values;return query;},async first(){return sqlite.prepare(sql).get(...args);},async run(){return {meta:{changes:sqlite.prepare(sql).run(...args).changes}};}};return query;}};
const server=http.createServer(async(incoming,outgoing)=>{
  try {
    const chunks=[];for await(const chunk of incoming)chunks.push(chunk);
    const body=Buffer.concat(chunks);
    const request=new Request('http://127.0.0.1:4173'+incoming.url,{method:incoming.method,headers:incoming.headers,body:body.length?body:undefined});
    const response=await worker.fetch(request,{DB});
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){outgoing.writeHead(500);outgoing.end(error.message);}
});
server.listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));
