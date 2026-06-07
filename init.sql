-- ============================================================
-- 식당 예약 + 주문 시스템 스키마
-- ============================================================

-- 1. 사용자 (1:N → 예약)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. 식당 (1:N → 예약, 1:N → 메뉴)
CREATE TABLE restaurants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    address TEXT NOT NULL,
    total_seats INT NOT NULL CHECK (total_seats > 0),
    open_time TIME NOT NULL DEFAULT '09:00',
    close_time TIME NOT NULL DEFAULT '22:00'
);

-- 3. 메뉴 (N:1 → 식당)
CREATE TABLE menus (
    id SERIAL PRIMARY KEY,
    restaurant_id INT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    price INT NOT NULL CHECK (price >= 0),
    description TEXT,
    available BOOLEAN DEFAULT true
);

-- 4. 예약 (N:1 → 사용자, N:1 → 식당) | 1:N → 주문
CREATE TABLE reservations (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    restaurant_id INT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    reserved_at TIMESTAMP NOT NULL,
    party_size INT NOT NULL CHECK (party_size > 0),
    status VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed')),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 5. 주문 항목 (다대다 중간 테이블: 예약 ↔ 메뉴)
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    reservation_id INT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    menu_id INT NOT NULL REFERENCES menus(id),
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price INT NOT NULL  -- 주문 당시 가격 스냅샷 (트랜잭션 핵심)
);

-- ============================================================
-- 인덱스 (쿼리 성능 최적화 / 벤치마킹 전후 비교용)
-- ============================================================
CREATE INDEX idx_reservations_restaurant ON reservations(restaurant_id);
CREATE INDEX idx_reservations_reserved_at ON reservations(reserved_at);
CREATE INDEX idx_order_items_reservation ON order_items(reservation_id);
CREATE INDEX idx_menus_restaurant ON menus(restaurant_id);

-- ============================================================
-- 시드 데이터
-- ============================================================

INSERT INTO users (name, email, phone) VALUES
('김민준', 'minjun@example.com', '010-1111-2222'),
('이서연', 'seoyeon@example.com', '010-3333-4444'),
('박지호', 'jiho@example.com', '010-5555-6666'),
('최유나', 'yuna@example.com', '010-7777-8888'),
('정하은', 'haeun@example.com', '010-9999-0000');

INSERT INTO restaurants (name, address, total_seats, open_time, close_time) VALUES
('한강 뷰 레스토랑', '서울시 마포구 한강로 1', 60, '11:00', '22:00'),
('이탈리안 키친', '서울시 강남구 테헤란로 42', 40, '12:00', '21:00'),
('전통 한식당', '서울시 종로구 인사동길 10', 50, '10:00', '21:00');

INSERT INTO menus (restaurant_id, name, price, description) VALUES
(1, '한우 등심 스테이크', 65000, '국내산 한우 1등급 등심'),
(1, '랍스터 파스타', 45000, '보스턴 랍스터와 크림소스'),
(1, '시저 샐러드', 18000, '로메인 상추와 홈메이드 드레싱'),
(2, '트러플 리조또', 38000, '블랙 트러플 오일과 파마산'),
(2, '마르게리타 피자', 22000, '이탈리아 토마토 소스와 생모짜렐라'),
(2, '티라미수', 12000, '클래식 이탈리안 디저트'),
(3, '갈비탕', 18000, '국내산 소갈비 12시간 육수'),
(3, '비빔밥', 14000, '제철 나물과 고추장'),
(3, '해물파전', 16000, '신선한 해물과 쪽파');

-- 샘플 예약 (트랜잭션 테스트용)
INSERT INTO reservations (user_id, restaurant_id, reserved_at, party_size, status) VALUES
(1, 1, NOW() + INTERVAL '1 day', 2, 'confirmed'),
(2, 2, NOW() + INTERVAL '2 days', 4, 'confirmed'),
(3, 3, NOW() + INTERVAL '3 days', 3, 'confirmed');

INSERT INTO order_items (reservation_id, menu_id, quantity, unit_price) VALUES
(1, 1, 2, 65000),
(1, 3, 1, 18000),
(2, 4, 2, 38000),
(2, 5, 1, 22000),
(3, 7, 3, 18000);
