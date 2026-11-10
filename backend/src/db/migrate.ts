import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import mysql from 'mysql2/promise';
import {env} from '../config/env.js';

const conn=await mysql.createConnection({host:env.dbHost,port:env.dbPort,database:env.dbName,user:env.dbUser,password:env.dbPassword,multipleStatements:false});
try{const files=[fileURLToPath(new URL('../../../database/schema.sql',import.meta.url)),...(await fs.readdir(fileURLToPath(new URL('../../../database/migrations',import.meta.url)))).filter(x=>x.endsWith('.sql')).sort().map(x=>fileURLToPath(new URL(`../../../database/migrations/${x}`,import.meta.url)))];for(const path of files){const file=await fs.readFile(path,'utf8');for(const sql of file.split(';').map(x=>x.trim()).filter(Boolean))await conn.query(sql);}console.log('Schema y migraciones MySQL aplicadas.');}finally{await conn.end();}
