-- NetPoint Store seed data
USE netpoint;

-- Categories -------------------------------------------------------------
INSERT INTO categories (id, name, slug) VALUES
(1, 'Routers & Gateways', 'routers'),
(2, 'Switches', 'switches'),
(3, 'Cables & Adapters', 'cables'),
(4, 'Wi-Fi & Mesh', 'wifi'),
(5, 'Security Cameras', 'cameras'),
(6, 'Tools & Testers', 'tools'),
(7, 'Power & Racks', 'power');

-- Users (passwords stored as MD5 - legacy auth module) --------------------
INSERT INTO users (id, username, email, password_hash, role, display_name, phone, address, balance, points) VALUES
(1, 'admin',     'admin@netpoint.store',   MD5('admin123'), 'admin',    'NetPoint Admin', '+20 100 555 0101', '12 El Nasr St, Nasr City, Cairo',        0.00,    0),
(2, 'sarah.j',   'sarah.j@example.com',    MD5('Passw0rd'), 'customer', 'Sarah Jenkins',  '+20 100 555 0142', '8 Road 9, Maadi, Cairo',                 0.00,  320),
(3, 'mike_t',    'mike_t@example.com',     MD5('qwerty12'), 'customer', 'Mike Turner',    '+20 101 555 0187', '45 Corniche El Nil, Giza',              25.50,  140),
(4, 'emma.w',    'emma.w@example.com',     MD5('dragon99'), 'customer', 'Emma Walsh',     '+20 102 555 0213', '2 El Hegaz St, Heliopolis, Cairo',       0.00,   80),
(5, 'dkim',      'dkim@example.com',       MD5('letmein1'), 'customer', 'David Kim',      '+20 111 555 0345', '77 Tahrir St, Downtown, Cairo',          0.00,  450),
(6, 'priya.s',   'priya.s@example.com',    MD5('hunter2x'), 'customer', 'Priya Sharma',   '+20 122 555 0476', '19 El Batal Ahmed Abdel Aziz, Mohandessin, Giza', 10.00, 210);

-- Products -----------------------------------------------------------------
INSERT INTO products (id, name, description, price, stock, image_url, category_id, featured) VALUES
(1,  'NetPoint AC1200 Dual-Band Wi-Fi Router',        'Dual-band AC1200 router with 4x 10/100 LAN ports, guest network, and easy app setup. Covers up to 120 m².',            79.99, 42, '/img/products/ac1200-router.svg',    1, 1),
(2,  'NetPoint Mesh WiFi 6 System (2-Pack)',           'Whole-home WiFi 6 mesh coverage for up to 250 m². Seamless roaming, parental controls, WPA3.',                         149.99, 18, '/img/products/mesh-wifi6.svg',       4, 1),
(3,  'TP-Link 8-Port Gigabit Desktop Switch',          'Fanless 8-port gigabit desktop switch with plug-and-play setup and steel housing.',                                    34.50, 75, '/img/products/switch-8port.svg',     2, 0),
(4,  '24-Port Managed Rackmount Switch',               'Layer 2 managed switch with 24 gigabit ports, 2 SFP uplinks, VLAN support and QoS.',                                   189.00, 9, '/img/products/switch-24port.svg',    2, 1),
(5,  'Cat6 Patch Cable 3m (5-Pack)',                   'Snagless Cat6 UTP patch cables, 3 meters each, tested to 550MHz. Assorted colors.',                                    12.99, 240, '/img/products/cat6-3m-pack.svg',     3, 0),
(6,  'Cat6A Shielded Cable 10m',                       'S/FTP double-shielded Cat6A cable, 10 meters, supports 10GBase-T. Gold-plated contacts.',                              19.49, 130, '/img/products/cat6a-10m.svg',        3, 0),
(7,  'RJ45 Keystone Jacks (25-Pack)',                  'Tool-free RJ45 keystone jacks, Cat6 rated, punch-down style with dust caps. 110/Panduit compatible.',                  27.99, 88, '/img/products/keystone-25pk.svg',    3, 0),
(8,  'Pro Network Crimping Kit',                       'All-in-one crimp kit: ratcheting crimper, wire stripper, punch-down tool and 50 RJ45 connectors.',                     39.95, 54, '/img/products/crimp-kit.svg',        6, 0),
(9,  'RJ45 Cable Tester Pro',                          'Tests pin configuration of RJ45/RJ11 cables in seconds. Remote unit lets you test installed runs.',                    24.99, 61, '/img/products/cable-tester.svg',     6, 0),
(10, 'PoE Injector 802.3at (30W)',                     'Gigabit PoE+ injector, powers APs and IP cameras over existing cabling. Up to 30W output.',                            22.50, 97, '/img/products/poe-injector.svg',     3, 0),
(11, 'Outdoor IP Security Camera 2K',                  'Weatherproof 2K IP camera with night vision, motion alerts and local SD storage. ONVIF compatible.',                   89.99, 33, '/img/products/ipcam-2k.svg',         5, 1),
(12, 'Indoor Pan-Tilt Camera 1080p',                   '1080p indoor camera with 355° pan / 90° tilt, two-way audio and motion tracking.',                                     54.99, 47, '/img/products/ipcam-ptz.svg',        5, 0),
(13, '600VA UPS Battery Backup',                       'Line-interactive UPS with AVR, 8 outlets and USB monitoring. Keeps your router online during outages.',                74.95, 26, '/img/products/ups-600va.svg',        7, 0),
(14, 'Wall-Mount Network Rack 9U',                     '9U wall-mount cabinet, lockable glass door, adjustable rails and built-in cable management.',                          64.00, 15, '/img/products/rack-9u.svg',          7, 0);

-- Reviews -------------------------------------------------------------------
INSERT INTO reviews (product_id, user_id, rating, body, created_at) VALUES
(1, 2, 5, 'Been running this router for 3 months now. Zero drops, setup took literally five minutes through the app. Great value for the price.', NOW() - INTERVAL 40 DAY),
(1, 3, 4, 'Solid little router. Range in my apartment is fine but struggles through concrete walls upstairs. For the money though, hard to beat.', NOW() - INTERVAL 33 DAY),
(2, 5, 5, 'Upgraded from a single router to this mesh system and the dead zone in the bedroom is finally gone. Roaming between nodes works exactly as advertised.', NOW() - INTERVAL 21 DAY),
(4, 3, 5, 'Deployed two of these in our small office rack. VLANs were straightforward to configure and they run cool even fully loaded.', NOW() - INTERVAL 15 DAY),
(5, 4, 4, 'Good quality cables, nice strain relief on the connectors. One of the five had a slightly bent clip but still clicks into place.', NOW() - INTERVAL 12 DAY),
(8, 6, 5, 'The crimper has a solid ratchet action and the stripped lengths come out perfect every time. Punch-down tool is a nice bonus at this price.', NOW() - INTERVAL 9 DAY),
(11, 5, 4, 'Picture quality during the day is excellent, night vision could be a bit brighter but overall very happy. App notifications are instant.', NOW() - INTERVAL 6 DAY),
(13, 2, 5, 'Bought this after a power cut killed my old router. Now the internet stays up long enough to ride out short outages. Software works on Linux too.', NOW() - INTERVAL 3 DAY);

-- Coupons -------------------------------------------------------------------
INSERT INTO coupons (code, percent_off, max_uses, uses, note) VALUES
('WELCOME10', 10, NULL,   0,   'Welcome offer - 10% off your order'),
('SAVE5',     5,  500,    137, 'Seasonal promo'),
('STACK20',   20, NULL,   12,  'Flash sale - stackable with other offers');

-- Sample orders ---------------------------------------------------------------
INSERT INTO orders (id, user_id, total, discount_percent, coupon_codes, status, gift_message, ship_address, created_at) VALUES
(1001, 2, 92.98,  0,  NULL,         'delivered', NULL, '8 Road 9, Maadi, Cairo', NOW() - INTERVAL 41 DAY),
(1002, 2, 54.99,  0,  NULL,         'shipped',   'Congrats on the new place!', '8 Road 9, Maadi, Cairo', NOW() - INTERVAL 8 DAY),
(1003, 3, 213.99, 10, 'WELCOME10',  'processing',NULL, '45 Corniche El Nil, Giza', NOW() - INTERVAL 2 DAY);

INSERT INTO order_items (order_id, product_id, name, qty, unit_price) VALUES
(1001, 1, 'NetPoint AC1200 Dual-Band Wi-Fi Router', 1, 79.99),
(1001, 5, 'Cat6 Patch Cable 3m (5-Pack)',           1, 12.99),
(1002, 12,'Indoor Pan-Tilt Camera 1080p',           1, 54.99),
(1003, 4, '24-Port Managed Rackmount Switch',       1, 189.00),
(1003, 9, 'RJ45 Cable Tester Pro',                  1, 24.99);

ALTER TABLE orders AUTO_INCREMENT = 1004;
ALTER TABLE products AUTO_INCREMENT = 15;
ALTER TABLE users AUTO_INCREMENT = 7;

-- Mock outbound mail (dev mailer writes here instead of SMTP) ----------------
INSERT INTO mail_log (to_email, subject, body, created_at) VALUES
('sarah.j@example.com', 'Welcome to NetPoint Store!', 'Hi Sarah, thanks for creating an account at NetPoint Store. Use code WELCOME10 for 10% off your first order.', NOW() - INTERVAL 45 DAY),
('mike_t@example.com',  'Welcome to NetPoint Store!', 'Hi Mike, thanks for creating an account at NetPoint Store. Use code WELCOME10 for 10% off your first order.', NOW() - INTERVAL 38 DAY),
('emma.w@example.com',  'NetPoint Store - Password Reset', CONCAT('Hello Emma, we received a request to reset your password. Open this link within 30 days: http://localhost:9000/reset?token=', MD5(CONCAT('4:emma.w@example.com')), '\n\nIf you did not request this you can ignore this email.'), NOW() - INTERVAL 5 DAY);
