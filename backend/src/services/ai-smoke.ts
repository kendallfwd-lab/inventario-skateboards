import {askGemini} from './gemini.js';
import {env} from '../config/env.js';

if(!env.geminiKey){console.log('SKIP: GEMINI_API_KEY no configurada.');process.exit(0);}
try{
  const answer=await askGemini('Responde únicamente: conexión Gemini correcta.',{test:true},{strict:true});
  console.log(`Gemini respondió: ${answer.slice(0,120)}`);
}catch(e:any){
  console.error(`Gemini no disponible (${e.status||e.code||'error'}). No se imprimió la clave.`);
  process.exitCode=1;
}
