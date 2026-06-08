const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// PostgreSQL 연결 풀
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://admin:password123@localhost:5432/restaurant',
  options: '-c timezone=Asia/Seoul',
});

// Pool 연결 시 타임존 설정
pool.on('connect', (client) => {
  client.query("SET timezone = 'Asia/Seoul'");
});

// DB 연결 확인 + 스키마 자동 실행
const fs = require('fs');
pool.query('SELECT NOW()')
  .then(() => {
    console.log('DB 연결 성공');
    const sql = fs.readFileSync(path.join(__dirname, '../init.sql'), 'utf8');
    return pool.query(sql);
  })
  .then(() => console.log('스키마 초기화 완료'))
  .catch(err => console.error('DB 초기화 실패:', err.message));

// DB 풀을 라우터에서 사용할 수 있도록 주입
app.use((req, res, next) => {
  req.db = pool;
  next();
});

// 라우터
app.use('/api/restaurants', require('./routes/restaurants'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/menus', require('./routes/menus'));

// 헬스 체크
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 에러 핸들러
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
