const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Връзка с базата данни (DragX)
const db = mysql.createPool({
    host: 'localhost',
    user: 'dragx_user',
    password: '123456',
    database: 'dragx_db',
    charset: 'utf8mb4'
});

// Начален тест на сървъра
app.get('/', (req, res) => {
    res.send('DragX Backend сървърът работи перфектно! 🏎️🔥');
});

// ==========================================
// 1. АВТОРИЗАЦИЯ И ПОТРЕБИТЕЛИ
// ==========================================

// Регистрация на нов потребител (с начални пари, кредити и гориво)
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Моля, попълни всички полета!' });
    }

    try {
        const [existing] = await db.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Това потребителско име или имейл вече са заети!' });
        }

        await db.query(
            'INSERT INTO users (username, email, password, money, credits, fuel, max_fuel) VALUES (?, ?, ?, 1000.00, 10, 100, 100)', 
            [username, email, password]
        );
        res.json({ success: true, message: 'Успешна регистрация! Вече можеш да влезеш в акаунта си.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Вход в системата
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Моля, попълни потребителско име и парола!' });
    }

    try {
        const [users] = await db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
        if (users.length === 0) {
            return res.status(400).json({ error: 'Грешно име или парола!' });
        }

        const user = users[0];
        res.json({ 
            success: true, 
            message: 'Успешен вход!', 
            user: { 
                id: user.id, 
                username: user.username, 
                money: user.money, 
                credits: user.credits, 
                fuel: user.fuel, 
                max_fuel: user.max_fuel,
                level: user.level,
                xp: user.xp,
                unlimited_fuel_until: user.unlimited_fuel_until
            } 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ==========================================
// 2. КОЛИ И ГАРАЖ
// ==========================================

// Взимане на началните безплатни коли от каталога (price = 0)
app.get('/api/free-cars', async (req, res) => {
    try {
        const [cars] = await db.query('SELECT * FROM cars WHERE price = 0');
        res.json(cars);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Проверка дали потребителят вече има кола в гаража
app.get('/api/my-car/:userId', async (req, res) => {
    try {
        const [cars] = await db.query('SELECT * FROM user_cars WHERE user_id = ?', [req.params.userId]);
        if (cars.length > 0) {
            res.json({ hasCar: true, car: cars[0] });
        } else {
            res.json({ hasCar: false });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Записване на избрана кола в гаража
app.post('/api/buy-car', async (req, res) => {
    const { userId, carName, hp, weight } = req.body;

    if (!userId || !carName) {
        return res.status(400).json({ error: 'Липсват данни за потребителя или колата!' });
    }

    try {
        const [existingCars] = await db.query('SELECT * FROM user_cars WHERE user_id = ?', [userId]);
        if (existingCars.length > 0) {
            return res.status(400).json({ error: 'Ти вече имаш кола в своя гараж!' });
        }

        await db.query(
            'INSERT INTO user_cars (user_id, car_name, hp, weight) VALUES (?, ?, ?, ?)',
            [userId, carName, hp, weight]
        );

        res.json({ success: true, message: `Колата ${carName} беше успешно добавена в твоя гараж!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ==========================================
// 3. МАГАЗИН, ЧАСТИ И ПИСТИ
// ==========================================

// Взимане на всички тунинг части (с тяхната рядкост)
app.get('/api/parts', async (req, res) => {
    try {
        const [parts] = await db.query('SELECT * FROM parts');
        res.json(parts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Взимане на пистите за състезания
app.get('/api/tracks', async (req, res) => {
    try {
        const [tracks] = await db.query('SELECT * FROM tracks');
        res.json(tracks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Взимане на платените пакети от магазина (Pay-to-Win / Буустове)
app.get('/api/shop', async (req, res) => {
    try {
        const [packages] = await db.query('SELECT * FROM shop_packages');
        res.json(packages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Стартиране на сървъра (поддържа и Render, и локално)
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DragX бекенд сървърът е стартиран на порт ${PORT}`);
});