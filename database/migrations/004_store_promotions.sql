CREATE TABLE IF NOT EXISTS store_promotions(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  discount_type ENUM('PERCENTAGE','FIXED') NOT NULL,
  discount_value DECIMAL(12,2) NOT NULL CHECK(discount_value>0),
  minimum_subtotal_crc DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK(minimum_subtotal_crc>=0),
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  max_redemptions INT UNSIGNED NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CHECK(ends_at>starts_at),
  CHECK(discount_type<>'PERCENTAGE' OR discount_value<=100),
  FOREIGN KEY(created_by) REFERENCES usuarios(id),
  INDEX idx_store_promotion_active_dates(active,starts_at,ends_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_order_promotions(
  order_id BIGINT UNSIGNED PRIMARY KEY,
  promotion_id BIGINT UNSIGNED NOT NULL,
  promotion_code VARCHAR(30) NOT NULL,
  discount_type ENUM('PERCENTAGE','FIXED') NOT NULL,
  discount_value DECIMAL(12,2) NOT NULL,
  subtotal_crc DECIMAL(14,2) NOT NULL CHECK(subtotal_crc>=0),
  discount_crc DECIMAL(14,2) NOT NULL CHECK(discount_crc>=0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES customer_orders(id),
  FOREIGN KEY(promotion_id) REFERENCES store_promotions(id),
  INDEX idx_order_promotion_redemptions(promotion_id,created_at)
) ENGINE=InnoDB;
