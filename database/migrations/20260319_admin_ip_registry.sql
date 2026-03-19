-- Admin panel IP access registry
CREATE TABLE IF NOT EXISTS admin_ip_registry (
  admin_ip_id SERIAL PRIMARY KEY,
  ip_address VARCHAR(100) NOT NULL UNIQUE,
  access_number INT NOT NULL UNIQUE,
  first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id INT REFERENCES users(user_id)
);
