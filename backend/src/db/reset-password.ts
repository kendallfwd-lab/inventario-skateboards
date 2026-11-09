import readline from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import bcrypt from 'bcryptjs';
import {pool} from './connection.js';

async function hidden(prompt:string){
  if(!stdin.isTTY||!stdin.setRawMode)throw new Error('Ejecuta este comando desde una terminal interactiva.');
  stdout.write(prompt);
  return await new Promise<string>((resolve)=>{
    let value='';
    stdin.setRawMode(true);stdin.resume();
    const handler=(chunk:Buffer)=>{for(const ch of chunk.toString()){
      if(ch==='\r'||ch==='\n'){stdin.off('data',handler);stdin.setRawMode(false);stdout.write('\n');resolve(value);return;}
      if(ch==='\u0003')process.exit(130);
      if(ch==='\u007f'){value=value.slice(0,-1);continue;}
      value+=ch;
    }};
    stdin.on('data',handler);
  });
}

const rl=readline.createInterface({input:stdin,output:stdout});
try{
  const email=(await rl.question('Correo del usuario: ')).trim().toLowerCase();
  rl.close();
  const password=await hidden('Nueva contraseña (mínimo 12 caracteres; no se muestra): ');
  if(!email.includes('@')||password.length<12)throw new Error('Correo inválido o contraseña menor de 12 caracteres.');
  const hash=await bcrypt.hash(password,12);
  const [result]:any=await pool.execute('UPDATE usuarios SET password_hash=? WHERE email=?',[hash,email]);
  if(result.affectedRows!==1)throw new Error('No existe un usuario con ese correo.');
  await pool.execute('DELETE s FROM sesiones s JOIN usuarios u ON u.id=s.usuario_id WHERE u.email=?',[email]);
  console.log('Contraseña actualizada. Las sesiones anteriores fueron cerradas.');
}catch(error:any){console.error(error.message);process.exitCode=1;}finally{rl.close();await pool.end();}
