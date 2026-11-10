CREATE TABLE IF NOT EXISTS demo_batches(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(80) NOT NULL UNIQUE,
  descripcion VARCHAR(255) NOT NULL,
  es_activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS clientes(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL UNIQUE,
  nombre VARCHAR(160) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  telefono VARCHAR(40) NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  demo_batch_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(demo_batch_id) REFERENCES demo_batches(id),
  INDEX idx_clientes_activo(activo)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ventas(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  referencia VARCHAR(48) NOT NULL UNIQUE,
  cliente_id BIGINT UNSIGNED NOT NULL,
  estado ENUM('PENDIENTE','CONFIRMADA','CANCELADA','DEVUELTA') NOT NULL DEFAULT 'PENDIENTE',
  subtotal_crc DECIMAL(14,2) NOT NULL DEFAULT 0,
  descuento_crc DECIMAL(14,2) NOT NULL DEFAULT 0,
  devolucion_crc DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_neto_crc DECIMAL(14,2) NOT NULL DEFAULT 0,
  cogs_crc DECIMAL(14,2) NOT NULL DEFAULT 0,
  fecha DATETIME NOT NULL,
  demo_batch_id BIGINT UNSIGNED NULL,
  FOREIGN KEY(cliente_id) REFERENCES clientes(id),
  FOREIGN KEY(demo_batch_id) REFERENCES demo_batches(id),
  INDEX idx_ventas_fecha_estado(fecha,estado)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS venta_detalle(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  venta_id BIGINT UNSIGNED NOT NULL,
  variante_id BIGINT UNSIGNED NOT NULL,
  cantidad INT UNSIGNED NOT NULL CHECK(cantidad>0),
  precio_unitario_crc DECIMAL(14,2) NOT NULL CHECK(precio_unitario_crc>=0),
  costo_unitario_crc DECIMAL(14,2) NOT NULL CHECK(costo_unitario_crc>=0),
  FOREIGN KEY(venta_id) REFERENCES ventas(id) ON DELETE CASCADE,
  FOREIGN KEY(variante_id) REFERENCES store_variants(id),
  UNIQUE KEY uq_venta_variante(venta_id,variante_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categorias_gasto(
  id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL UNIQUE,
  nombre VARCHAR(90) NOT NULL UNIQUE,
  activo BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gastos(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  referencia VARCHAR(48) NOT NULL UNIQUE,
  categoria_id SMALLINT UNSIGNED NOT NULL,
  descripcion VARCHAR(255) NOT NULL,
  monto_crc DECIMAL(14,2) NOT NULL CHECK(monto_crc>=0),
  fecha DATE NOT NULL,
  estado ENUM('REGISTRADO','ANULADO') NOT NULL DEFAULT 'REGISTRADO',
  demo_batch_id BIGINT UNSIGNED NULL,
  FOREIGN KEY(categoria_id) REFERENCES categorias_gasto(id),
  FOREIGN KEY(demo_batch_id) REFERENCES demo_batches(id),
  INDEX idx_gastos_fecha_categoria(fecha,categoria_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cuentas_por_pagar(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  referencia VARCHAR(48) NOT NULL UNIQUE,
  proveedor_id BIGINT UNSIGNED NOT NULL,
  factura_id BIGINT UNSIGNED NULL,
  fecha_emision DATE NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  importe_crc DECIMAL(14,2) NOT NULL CHECK(importe_crc>=0),
  estado ENUM('ABIERTA','PAGADA','ANULADA') NOT NULL DEFAULT 'ABIERTA',
  demo_batch_id BIGINT UNSIGNED NULL,
  FOREIGN KEY(proveedor_id) REFERENCES proveedores(id),
  FOREIGN KEY(factura_id) REFERENCES facturas(id),
  FOREIGN KEY(demo_batch_id) REFERENCES demo_batches(id),
  INDEX idx_cpp_vencimiento_estado(fecha_vencimiento,estado)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS abonos_cuenta(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cuenta_id BIGINT UNSIGNED NOT NULL,
  referencia VARCHAR(48) NOT NULL UNIQUE,
  fecha DATE NOT NULL,
  monto_crc DECIMAL(14,2) NOT NULL CHECK(monto_crc>0),
  FOREIGN KEY(cuenta_id) REFERENCES cuentas_por_pagar(id) ON DELETE CASCADE
) ENGINE=InnoDB;
