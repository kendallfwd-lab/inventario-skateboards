ALTER TABLE clientes MODIFY COLUMN email VARCHAR(190) NULL;

CREATE TABLE IF NOT EXISTS crm_client_profiles(
  cliente_id BIGINT UNSIGNED PRIMARY KEY,
  etapa ENUM('NUEVO','INTERESADO','CONTACTADO','PEDIDO_SOLICITADO','CLIENTE','RECURRENTE','INACTIVO') NOT NULL DEFAULT 'NUEVO',
  preferencias_json JSON NULL,
  notas_admin VARCHAR(2000) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY(cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS crm_customer_contacts(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id BIGINT UNSIGNED NOT NULL,
  tipo ENUM('EMAIL','TELEFONO') NOT NULL,
  valor VARCHAR(190) NOT NULL,
  valor_normalizado VARCHAR(190) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_crm_contact_normalized(tipo,valor_normalizado),
  INDEX idx_crm_contact_customer(cliente_id),
  FOREIGN KEY(cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS crm_customer_consents(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id BIGINT UNSIGNED NOT NULL,
  granted BOOLEAN NOT NULL,
  channel ENUM('WEB','PRESENCIAL','TELEFONO','OTRO') NOT NULL,
  notice_version VARCHAR(40) NOT NULL,
  recorded_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
  FOREIGN KEY(recorded_by) REFERENCES usuarios(id),
  INDEX idx_crm_consent_customer_date(cliente_id,created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS crm_customer_followups(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id BIGINT UNSIGNED NOT NULL,
  tipo ENUM('NOTA','TAREA') NOT NULL,
  estado ENUM('PENDIENTE','COMPLETADO','CANCELADO') NOT NULL DEFAULT 'PENDIENTE',
  titulo VARCHAR(160) NOT NULL,
  detalle VARCHAR(1000) NULL,
  vence_at DATETIME NULL,
  asignado_a BIGINT UNSIGNED NULL,
  creado_por BIGINT UNSIGNED NOT NULL,
  completado_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY(cliente_id) REFERENCES clientes(id),
  FOREIGN KEY(asignado_a) REFERENCES usuarios(id),
  FOREIGN KEY(creado_por) REFERENCES usuarios(id),
  INDEX idx_crm_followup_due(estado,vence_at),
  INDEX idx_crm_followup_customer(cliente_id,created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS crm_customer_order_links(
  order_id BIGINT UNSIGNED PRIMARY KEY,
  cliente_id BIGINT UNSIGNED NOT NULL,
  metodo ENUM('EMAIL','TELEFONO','MANUAL') NOT NULL,
  vinculado_por BIGINT UNSIGNED NULL,
  linked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES customer_orders(id),
  FOREIGN KEY(cliente_id) REFERENCES clientes(id),
  FOREIGN KEY(vinculado_por) REFERENCES usuarios(id),
  INDEX idx_crm_order_link_customer(cliente_id,linked_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_order_payment_events(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM('PAYMENT','REFUND') NOT NULL,
  amount_crc DECIMAL(14,2) NOT NULL CHECK(amount_crc>0),
  method ENUM('CASH','TRANSFER','CARD','OTHER') NOT NULL,
  reference VARCHAR(120) NOT NULL,
  related_payment_id BIGINT UNSIGNED NULL,
  idempotency_key VARCHAR(100) NOT NULL UNIQUE,
  recorded_by BIGINT UNSIGNED NOT NULL,
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((event_type='PAYMENT' AND related_payment_id IS NULL) OR (event_type='REFUND' AND related_payment_id IS NOT NULL)),
  FOREIGN KEY(order_id) REFERENCES customer_orders(id),
  FOREIGN KEY(related_payment_id) REFERENCES customer_order_payment_events(id),
  FOREIGN KEY(recorded_by) REFERENCES usuarios(id),
  INDEX idx_customer_payment_order_date(order_id,occurred_at),
  INDEX idx_customer_payment_related(related_payment_id,event_type)
) ENGINE=InnoDB;
