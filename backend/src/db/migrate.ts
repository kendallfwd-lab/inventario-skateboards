import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import mysql from 'mysql2/promise';
import {env} from '../config/env.js';

const conn=await mysql.createConnection({host:env.dbHost,port:env.dbPort,database:env.dbName,user:env.dbUser,password:env.dbPassword,multipleStatements:false});
try{
  const schemaPath=fileURLToPath(new URL('../../../database/schema.sql',import.meta.url));
  const migrationsDir=fileURLToPath(new URL('../../../database/migrations',import.meta.url));
  const schema=await fs.readFile(schemaPath,'utf8');
  for(const sql of schema.split(';').map(x=>x.trim()).filter(Boolean))await conn.query(sql);
  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations(
    version VARCHAR(160) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  const files=(await fs.readdir(migrationsDir)).filter(x=>x.endsWith('.sql')).sort();
  for(const version of files){
    const [[applied]]=await conn.execute<any[]>('SELECT version FROM schema_migrations WHERE version=?',[version]);
    if(applied)continue;
    const file=await fs.readFile(fileURLToPath(new URL(`../../../database/migrations/${version}`,import.meta.url)),'utf8');
    for(const sql of file.split(';').map(x=>x.trim()).filter(Boolean))await conn.query(sql);
    await conn.execute('INSERT INTO schema_migrations(version) VALUES(?)',[version]);
    console.log(`Migración aplicada: ${version}`);
  }
  console.log('Schema y migraciones MySQL aplicadas.');
}finally{await conn.end();}
