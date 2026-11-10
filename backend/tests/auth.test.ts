import test from 'node:test';
import assert from 'node:assert/strict';
import {app} from '../src/app.js';
import {env} from '../src/config/env.js';
import {sameOrigin} from '../src/middleware/auth.js';

test('API devuelve 401 a /auth/me sin cookie, sin necesidad de consultar MySQL',async()=>{const server=app.listen(0,'127.0.0.1');try{await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const response=await fetch(`http://127.0.0.1:${address.port}/api/auth/me`);assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:'Autenticación requerida'});}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}});

test('acepta el origen de Vite en loopback durante desarrollo',()=>{assert.ok(env.allowedOrigins.includes('http://127.0.0.1:5173'));});

test('rechaza mutaciones desde un origen externo',()=>{let status=0;let body='';const req={method:'POST',get:()=> 'https://sitio-no-autorizado.example'} as never;const res={status:(code:number)=>{status=code;return res;},json:(value:{error:string})=>{body=value.error;return res;}} as never;sameOrigin(req,res,()=>assert.fail('no debe continuar'));assert.equal(status,403);assert.equal(body,'Origen no permitido');});

test('CORS responde 403 y no 500 cuando el origen no está autorizado',async()=>{const server=app.listen(0,'127.0.0.1');try{await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const response=await fetch(`http://127.0.0.1:${address.port}/api/auth/login`,{method:'POST',headers:{origin:'https://sitio-no-autorizado.example','content-type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'password-segura'})});assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'Origen no permitido'});}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}});
