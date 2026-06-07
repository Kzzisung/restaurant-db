# 식당 예약 + 주문 시스템

> PostgreSQL을 활용한 웹 서비스 데이터베이스 프로젝트

## 기술 스택

- **Backend**: Node.js + Express
- **Database**: PostgreSQL 16
- **Frontend**: HTML/CSS/JS (Vanilla)
- **Infra**: Docker Compose
- **Benchmark**: k6

---

## 데이터베이스 설계

### 릴레이션 구조

| 테이블 | 설명 | 관계 |
|--------|------|------|
| `users` | 사용자 | - |
| `restaurants` | 식당 | - |
| `menus` | 메뉴 | N:1 → restaurants |
| `reservations` | 예약 | N:1 → users, N:1 → restaurants |
| `order_items` | 주문 항목 (중간 테이블) | N:1 → reservations, N:1 → menus |

### 관계 요약

```
USERS ──────< RESERVATIONS >────── RESTAURANTS
                    │
                    └──────< ORDER_ITEMS >────── MENUS
                                                     │
                                               (restaurants)
```

- **1:N**: users → reservations, restaurants → reservations, restaurants → menus
- **N:M**: reservations ↔ menus (order_items 중간 테이블)

---

## 트랜잭션 설계

### 예약 생성 트랜잭션 (`POST /api/reservations`)

```sql
BEGIN;
  -- 1. 식당 좌석 잠금 (동시성 제어)
  SELECT total_seats FROM restaurants WHERE id = $1 FOR UPDATE;

  -- 2. 해당 시간대 예약 좌석 합산
  SELECT SUM(party_size) FROM reservations
  WHERE restaurant_id = $1 AND reserved_at BETWEEN ... ;

  -- 3. 좌석 여유 확인 후 예약 INSERT
  INSERT INTO reservations (...) VALUES (...);

  -- 4. 주문 항목 INSERT + 현재 가격 스냅샷
  INSERT INTO order_items (reservation_id, menu_id, quantity, unit_price)
  VALUES (..., (SELECT price FROM menus WHERE id = $2));
COMMIT; -- 또는 실패 시 ROLLBACK
```

**보장 사항**: 좌석 초과 예약 방지, 가격 변동에도 주문 당시 가격 보존

---

## 실행 방법

### 1. 프로젝트 시작

```bash
git clone <repo-url>
cd restaurant-db
docker compose up -d
```

- DB 초기화는 자동으로 `init.sql` 실행
- 백엔드: http://localhost:3000
- 프론트엔드: http://localhost:3000 (정적 파일 서빙)

### 2. API 테스트

```bash
# 식당 목록
curl http://localhost:3000/api/restaurants

# 예약 생성 (트랜잭션)
curl -X POST http://localhost:3000/api/reservations \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 1,
    "restaurant_id": 1,
    "reserved_at": "2025-12-25T19:00:00",
    "party_size": 2,
    "order_items": [{"menu_id": 1, "quantity": 1}]
  }'

# 예약 취소
curl -X PATCH http://localhost:3000/api/reservations/1/cancel

# 인기 메뉴 통계
curl http://localhost:3000/api/menus/popular
```

### 3. 벤치마킹 실행

```bash
# k6 설치 (Mac)
brew install k6

# 기본 실행
k6 run benchmark/k6_script.js

# VU 수 / 시간 지정
k6 run --vus 50 --duration 30s benchmark/k6_script.js
```

---

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/restaurants` | 식당 목록 + 예약 수 |
| GET | `/api/restaurants/:id` | 식당 상세 + 메뉴 |
| GET | `/api/restaurants/:id/stats` | 식당 통계 (복합 쿼리) |
| GET | `/api/reservations` | 전체 예약 (JOIN) |
| GET | `/api/reservations/:id` | 예약 상세 |
| POST | `/api/reservations` | 예약 생성 (트랜잭션) |
| PATCH | `/api/reservations/:id/cancel` | 예약 취소 (트랜잭션) |
| GET | `/api/menus` | 메뉴 목록 |
| GET | `/api/menus/popular` | 인기 메뉴 통계 |

---

## 디렉토리 구조

```
restaurant-db/
├── docker-compose.yml        # PostgreSQL + 백엔드 컨테이너
├── init.sql                  # 스키마 정의 + 시드 데이터
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── index.js              # Express 서버 진입점
│   └── routes/
│       ├── restaurants.js    # 식당 API
│       ├── reservations.js   # 예약 API (트랜잭션)
│       └── menus.js          # 메뉴 API
├── frontend/
│   └── index.html            # 단일 페이지 UI
└── benchmark/
    └── k6_script.js          # k6 벤치마킹 스크립트
```
