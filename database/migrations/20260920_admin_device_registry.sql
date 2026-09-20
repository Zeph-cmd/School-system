-- Admin panel device access registry (stable identity across IP changes)
CREATE TABLE IF NOT EXISTS admin_device_registry (
  admin_device_id SERIAL PRIMARY KEY,
  device_hash VARCHAR(128) NOT NULL UNIQUE,
  device_label VARCHAR(200),
  access_number INT NOT NULL UNIQUE,
  first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id INT REFERENCES users(user_id)
);
