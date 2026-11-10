CREATE TABLE IF NOT EXISTS store_products(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(120) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  product_type ENUM('DECK','COMPLETE') NOT NULL DEFAULT 'DECK',
  collection_name VARCHAR(120) NOT NULL,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS store_variants(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  material_id BIGINT UNSIGNED NOT NULL UNIQUE,
  sku VARCHAR(48) NOT NULL UNIQUE,
  size_in VARCHAR(12) NOT NULL,
  sale_price_crc DECIMAL(14,2) NOT NULL CHECK(sale_price_crc>=0),
  low_stock_threshold INT UNSIGNED NOT NULL DEFAULT 1,
  grip_image_url VARCHAR(500) NULL,
  graphic_image_url VARCHAR(500) NULL,
  specs_json JSON NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  FOREIGN KEY(product_id) REFERENCES store_products(id),
  FOREIGN KEY(material_id) REFERENCES materiales(id),
  INDEX idx_store_variant_product(product_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_orders(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(32) NOT NULL UNIQUE,
  status ENUM('PENDING','ACCEPTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  customer_name VARCHAR(160) NOT NULL,
  customer_contact VARCHAR(190) NOT NULL,
  delivery_details VARCHAR(500) NOT NULL,
  notes VARCHAR(500) NULL,
  total_crc DECIMAL(14,2) NOT NULL DEFAULT 0,
  accepted_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customer_order_status(status,created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_order_lines(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  variant_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL CHECK(quantity>0),
  applied_price_crc DECIMAL(14,2) NOT NULL CHECK(applied_price_crc>=0),
  FOREIGN KEY(order_id) REFERENCES customer_orders(id) ON DELETE CASCADE,
  FOREIGN KEY(variant_id) REFERENCES store_variants(id),
  UNIQUE KEY uq_customer_order_variant(order_id,variant_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS store_settings(
  setting_key VARCHAR(80) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL
) ENGINE=InnoDB;
