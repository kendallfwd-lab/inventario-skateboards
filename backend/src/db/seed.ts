import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import mysql from 'mysql2/promise';
import {env} from '../config/env.js';

const conn=await mysql.createConnection({host:env.dbHost,port:env.dbPort,database:env.dbName,user:env.dbUser,password:env.dbPassword,multipleStatements:false});
try{const file=await fs.readFile(fileURLToPath(new URL('../../../database/seed.sql',import.meta.url)),'utf8');for(const sql of file.split(';').map(x=>x.trim()).filter(Boolean))await conn.query(sql);await conn.query(`INSERT INTO alertas(material_id,ubicacion_id,stock_actual,punto_reorden,mensaje) SELECT m.id,u.id,CASE m.sku WHEN 'BLK-12-20-40' THEN 2800 ELSE 14 END,CASE m.sku WHEN 'BLK-12-20-40' THEN 3600 ELSE 20 END,'Stock en o bajo el punto de reorden' FROM materiales m JOIN ubicaciones u ON u.codigo='BOD-CENTRAL' WHERE m.sku IN('BLK-12-20-40','ARENA-M3') AND NOT EXISTS(SELECT 1 FROM alertas a WHERE a.material_id=m.id AND a.ubicacion_id=u.id AND a.estado<>'RESUELTA')`);console.log('Seeds académicos aplicados (repetibles).');}finally{await conn.end();}
