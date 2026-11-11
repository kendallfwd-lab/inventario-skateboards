import fs from 'node:fs/promises';import {fileURLToPath} from 'node:url';import mysql from 'mysql2/promise';import {env} from '../config/env.js';
const conn=await mysql.createConnection({host:env.dbHost,port:env.dbPort,user:env.dbUser,password:env.dbPassword,multipleStatements:false});
try{const file=await fs.readFile(fileURLToPath(new URL('../../../database/schema.sql',import.meta.url)),'utf8');for(const sql of file.split(';').map(x=>x.trim()).filter(Boolean))await conn.query(sql);console.log('Schema MySQL aplicado.');}finally{await conn.end();}
