const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Сервираме index.html и всички картинки/файлове от основната папка
app.use(express.static(__dirname));

// Връзка с базата данни (DragX) - готова за локално и облачно ползване
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'dragx_user',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'dragx_db',
    charset: 'utf8mb4'
});

// Начална страница -> зарежда играта
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// 1. АВТОРИЗАЦИЯ И ПОТРЕБИТЕЛИ
// ==========================================

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
        res.json({ success: true, message: 'Успешна регистрация! Вече можеш да влезеш.' });
    } catch (err) {
        res.status(500).json({ error: 'Грешка с базата данни: ' + err.message });
    }
});

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
            user: { 
                id: user.id, 
                username: user.username, 
                money: Number(user.money), 
                credits: user.credits, 
                fuel: user.fuel, 
                max_fuel: user.max_fuel,
                level: user.level || 1,
                xp: user.xp || 0
            } 
        });
    } catch (err) {
        res.status(500).json({ error: 'Грешка с базата данни: ' + err.message });
    }
});

// ==========================================
// 2. КОЛИ, ГАРАЖ, ЧАСТИ И ПИСТИ
// ==========================================

app.get('/api/free-cars', async (req, res) => {
    try {
        const [cars] = await db.query('SELECT * FROM cars WHERE price = 0');
        res.json(cars);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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

app.post('/api/buy-car', async (req, res) => {
    const { userId, carName, hp, weight } = req.body;
    try {
        const [existingCars] = await db.query('SELECT * FROM user_cars WHERE user_id = ?', [userId]);
        if (existingCars.length > 0) {
            return res.status(400).json({ error: 'Вече имаш кола в гаража!' });
        }

        await db.query(
            'INSERT INTO user_cars (user_id, car_name, hp, weight) VALUES (?, ?, ?, ?)',
            [userId, carName, hp, weight]
        );
        res.json({ success: true, message: `${carName} е добавена в гаража!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/parts', async (req, res) => {
    try {
        const [parts] = await db.query('SELECT * FROM parts');
        res.json(parts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Купуване и монтаж на тунинг част
app.post('/api/buy-part', async (req, res) => {
    const { userId, partId, price, hpBonus, weightReduction } = req.body;
    try {
        const [users] = await db.query('SELECT money FROM users WHERE id = ?', [userId]);
        if (!users.length || Number(users[0].money) < price) {
            return res.status(400).json({ error: 'Нямаш достатъчно пари!' });
        }

        await db.query('UPDATE users SET money = money - ? WHERE id = ?', [price, userId]);
        await db.query(
            'UPDATE user_cars SET hp = hp + ?, weight = GREATEST(700, weight - ?) WHERE user_id = ?',
            [hpBonus, weightReduction || 0, userId]
        );

        const [updatedUser] = await db.query('SELECT money FROM users WHERE id = ?', [userId]);
        const [updatedCar] = await db.query('SELECT * FROM user_cars WHERE user_id = ?', [userId]);

        res.json({ 
            success: true, 
            money: Number(updatedUser[0].money), 
            car: updatedCar[0] 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/tracks', async (req, res) => {
    try {
        const [tracks] = await db.query('SELECT * FROM tracks');
        res.json(tracks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Записване на резултат от състезание
app.post('/api/race-result', async (req, res) => {
    const { userId, won, rewardMoney, fuelCost } = req.body;
    try {
        const [users] = await db.query('SELECT fuel, money FROM users WHERE id = ?', [userId]);
        if (!users.length || users[0].fuel < fuelCost) {
            return res.status(400).json({ error: 'Нямаш достатъчно гориво!' });
        }

        const moneyChange = won ? rewardMoney : 0;
        await db.query(
            'UPDATE users SET fuel = fuel - ?, money = money + ? WHERE id = ?',
            [fuelCost, moneyChange, userId]
        );

        const [updated] = await db.query('SELECT fuel, money FROM users WHERE id = ?', [userId]);
        res.json({ 
            success: true, 
            fuel: updated[0].fuel, 
            money: Number(updated[0].money) 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/shop', async (req, res) => {
    try {
        const [packages] = await db.query('SELECT * FROM shop_packages');
        res.json(packages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DragX сървърът работи на порт ${PORT}`);
});