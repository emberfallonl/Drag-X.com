const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Сервираме index.html и файловете от основната папка
app.use(express.static(__dirname));

// Връзка с базата данни (DragX)
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'dragx',
    charset: 'utf8mb4'
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// 1. АВТОРИЗАЦИЯ И ПОТРЕБИТЕЛИ
// ==========================================

app.post('/api/register', async (req, res) => {
    const { username, password, starterCatalogId } = req.body;
    if (!username || !password || !starterCatalogId) {
        return res.status(400).json({ error: 'Моля, попълни всички полета и избери стартова кола!' });
    }

    try {
        const [existing] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Това потребителско име вече е заето!' });
        }

        // Регистрация с 15 000 лв. стартов капитал
        const [userResult] = await db.query(
            'INSERT INTO users (username, password, money, credits, fuel, max_fuel) VALUES (?, ?, 15000, 5, 100, 100)', 
            [username, password]
        );
        const userId = userResult.insertId;

        // Взимане на стартовата кола от каталога
        const [catalogCars] = await db.query('SELECT * FROM car_catalog WHERE id = ?', [starterCatalogId]);
        if (catalogCars.length === 0) {
            return res.status(400).json({ error: 'Невалидна стартова кола!' });
        }
        const carMeta = catalogCars[0];

        // Добавяне на колата в гаража на потребителя
        await db.query(
            'INSERT INTO user_cars (user_id, catalog_id, custom_name, current_hp, current_weight, is_active) VALUES (?, ?, ?, ?, ?, 1)',
            [userId, carMeta.id, carMeta.name, carMeta.base_hp, carMeta.base_weight]
        );

        res.json({ success: true, message: 'Успешна регистрация! Добре дошъл на улицата.' });
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
                bankMoney: Number(user.bank_money || 0),
                credits: user.credits, 
                connections: user.connections || 0,
                fuel: user.fuel, 
                max_fuel: user.max_fuel,
                level: user.level || 1,
                xp: user.xp || 0,
                avatar: user.avatar || '😎'
            } 
        });
    } catch (err) {
        res.status(500).json({ error: 'Грешка с базата данни: ' + err.message });
    }
});

// ==========================================
// 2. КОЛИ, ГАРАЖ, ЧАСТИ И АВТОСАЛОН
// ==========================================

// Взимане на стартовите коли (ценар 0 или достъпни за начало)
app.get('/api/free-cars', async (req, res) => {
    try {
        const [cars] = await db.query('SELECT * FROM car_catalog WHERE price_money <= 10000 AND required_level = 1');
        res.json(cars);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Пълен каталог на автосалона (20-те коли)
app.get('/api/dealership', async (req, res) => {
    try {
        const [cars] = await db.query('SELECT * FROM car_catalog ORDER BY required_level ASC');
        res.json(cars);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Гараж и монтирани части за конкретната кола на играча
app.get('/api/my-car/:userId', async (req, res) => {
    try {
        const [cars] = await db.query(`
            uc.*, cc.image_url FROM user_cars uc 
            JOIN car_catalog cc ON uc.catalog_id = cc.id 
            WHERE uc.user_id = ? AND uc.is_active = 1
        `, [req.params.userId]);

        if (cars.length > 0) {
            const activeCar = cars[0];
            // Взимаме монтираните части само за тази конкретна кола
            const [installedParts] = await db.query(`
                cip.slot_type, tp.name, tp.bonus_hp, tp.reduce_weight, tp.icon, tp.rarity 
                FROM car_installed_parts cip
                JOIN tuning_parts tp ON cip.part_id = tp.id
                WHERE cip.user_car_id = ?
            `, [activeCar.id]);

            res.json({ hasCar: true, car: activeCar, installedParts });
        } else {
            res.json({ hasCar: false });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Купуване на нова кола от автосалона
app.post('/api/buy-car', async (req, res) => {
    const { userId, catalogId, payType } = req.body; // payType: 'money' или 'credits'
    try {
        const [catalogCars] = await db.query('SELECT * FROM car_catalog WHERE id = ?', [catalogId]);
        if (!catalogCars.length) return res.status(400).json({ error: 'Колата не е намерена!' });
        const carMeta = catalogCars[0];

        const [users] = await db.query('SELECT money, credits, level FROM users WHERE id = ?', [userId]);
        const user = users[0];

        if (user.level < carMeta.required_level) {
            return res.status(400).json({ error: `Изисква се поне Ниво ${carMeta.required_level}!` });
        }

        if (payType === 'money') {
            if (Number(user.money) < carMeta.price_money) return res.status(400).json({ error: 'Нямаш достатъчно пари!' });
            await db.query('UPDATE users SET money = money - ? WHERE id = ?', [carMeta.price_money, userId]);
        } else {
            if (user.credits < carMeta.price_credits) return res.status(400).json({ error: 'Нямаш достатъчно VIP Кредити!' });
            await db.query('UPDATE users SET credits = credits - ? WHERE id = ?', [carMeta.price_credits, userId]);
        }

        // Деактивираме старата активна кола и слагаме новата
        await db.query('UPDATE user_cars SET is_active = 0 WHERE user_id = ?', [userId]);
        await db.query(
            'INSERT INTO user_cars (user_id, catalog_id, custom_name, current_hp, current_weight, is_active) VALUES (?, ?, ?, ?, ?, 1)',
            [userId, carMeta.id, carMeta.name, carMeta.base_hp, carMeta.base_weight]
        );

        const [updatedUser] = await db.query('SELECT money, credits FROM users WHERE id = ?', [userId]);
        res.json({ success: true, message: `Купи успешно ${carMeta.name}!`, user: updatedUser[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Тунинг части от сервиза
app.get('/api/parts', async (req, res) => {
    try {
        const [parts] = await db.query('SELECT * FROM tuning_parts WHERE is_drop_only = 0');
        res.json(parts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Купуване и монтаж на част (обвързано към конкретната кола)
app.post('/api/buy-part', async (req, res) => {
    const { userId, partId } = req.body;
    try {
        const [parts] = await db.query('SELECT * FROM tuning_parts WHERE id = ?', [partId]);
        if (!parts.length) return res.status(400).json({ error: 'Частта не съществува!' });
        const part = parts[0];

        const [users] = await db.query('SELECT money FROM users WHERE id = ?', [userId]);
        if (!users.length || Number(users[0].money) < part.price_money) {
            return res.status(400).json({ error: 'Нямаш достатъчно пари!' });
        }

        const [cars] = await db.query('SELECT * FROM user_cars WHERE user_id = ? AND is_active = 1', [userId]);
        if (!cars.length) return res.status(400).json({ error: 'Няма активна кола в гаража!' });
        const activeCar = cars[0];

        // Проверяваме дали вече има монтирана част в същия слот (напр. друг чип или турбо)
        const [existingSlot] = await db.query(
            'SELECT * FROM car_installed_parts WHERE user_car_id = ? AND slot_type = ?',
            [activeCar.id, part.slot_type]
        );

        let hpDiff = part.bonus_hp;
        let weightDiff = part.reduce_weight;

        if (existingSlot.length > 0) {
            // Ако има стара част в същия слот, взимаме нейните бонуси, за да ги сметнем коректно
            const [oldPartMeta] = await db.query('SELECT * FROM tuning_parts WHERE id = ?', [existingSlot[0].part_id]);
            if (oldPartMeta.length > 0) {
                hpDiff -= oldPartMeta[0].bonus_hp;
                weightDiff -= oldPartMeta[0].reduce_weight;
            }
            // Премахваме старата част от този слот за тази кола
            await db.query('DELETE FROM car_installed_parts WHERE id = ?', [existingSlot[0].id]);
        }

        // Таксуваме играча и обновяваме характеристиките на колата
        await db.query('UPDATE users SET money = money - ? WHERE id = ?', [part.price_money, userId]);
        await db.query(
            'UPDATE user_cars SET current_hp = current_hp + ?, current_weight = GREATEST(700, current_weight - ?) WHERE id = ?',
            [hpDiff, weightDiff, activeCar.id]
        );

        // Записваме новата част към конкретната кола
        await db.query(
            'INSERT INTO car_installed_parts (user_car_id, part_id, slot_type) VALUES (?, ?, ?)',
            [activeCar.id, part.id, part.slot_type]
        );

        const [updatedUser] = await db.query('SELECT money FROM users WHERE id = ?', [userId]);
        const [updatedCar] = await db.query('SELECT * FROM user_cars WHERE id = ?', [activeCar.id]);

        res.json({ 
            success: true, 
            money: Number(updatedUser[0].money), 
            car: updatedCar[0] 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3. ПИСТИ, ГОНКИ И КЛАСАЦИЯ (PvP)
// ==========================================

app.get('/api/tracks', async (req, res) => {
    try {
        // Можем да върнем стандартизирани писти
        const tracks = [
            { id: 1, name: 'Околовръстното', reward: 350, xp: 20, fuel_cost: 10 },
            { id: 2, name: 'Летище Божурище', reward: 700, xp: 35, fuel_cost: 10 },
            { id: 3, name: 'Индустриална зона', reward: 1300, xp: 50, fuel_cost: 10 },
            { id: 4, name: 'Битка на титаните', reward: 2600, xp: 80, fuel_cost: 10 }
        ];
        res.json(tracks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Резултат от гонка срещу бот
app.post('/api/race-result', async (req, res) => {
    const { userId, won, rewardMoney, fuelCost, xpReward } = req.body;
    try {
        const [users] = await db.query('SELECT fuel, money, xp, level, credits FROM users WHERE id = ?', [userId]);
        if (!users.length || users[0].fuel < fuelCost) {
            return res.status(400).json({ error: 'Нямаш достатъчно гориво!' });
        }

        const user = users[0];
        let newMoney = Number(user.money) + (won ? rewardMoney : 0);
        let newXp = user.xp + (won ? xpReward : 5);
        let newLevel = user.level;
        let newCredits = user.credits;
        let winsAdd = won ? 1 : 0;
        let lossesAdd = won ? 0 : 1;

        // Система за вдигане на ниво (на всеки 100 XP)
        if (newXp >= 100) {
            newLevel += 1;
            newXp -= 100;
            newCredits += 5; // Бонус 5 кредита при левел ъп
        }

        // Ако загуби, губи малка част от парите в джоба (ако има незащитени в банката)
        if (!won) {
            let lostCash = Math.min(200, newMoney);
            newMoney -= lostCash;
        }

        await db.query(
            'UPDATE users SET fuel = fuel - ?, money = ?, xp = ?, level = ?, credits = ?, wins = wins + ?, losses = losses + ? WHERE id = ?',
            [fuelCost, newMoney, newXp, newLevel, newCredits, winsAdd, lossesAdd, userId]
        );

        const [updated] = await db.query('SELECT fuel, money, xp, level, credits, wins, losses FROM users WHERE id = ?', [userId]);
        res.json({ 
            success: true, 
            user: {
                fuel: updated[0].fuel, 
                money: Number(updated[0].money),
                xp: updated[0].xp,
                level: updated[0].level,
                credits: updated[0].credits,
                wins: updated[0].wins,
                losses: updated[0].losses
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Топ пилоти за класацията
app.get('/api/ranking', async (req, res) => {
    try {
        const [topUsers] = await db.query(`
            u.id, u.username, u.wins, u.level, uc.current_hp, cc.name as car_name 
            FROM users u
            LEFT JOIN user_cars uc ON u.id = uc.user_id AND uc.is_active = 1
            LEFT JOIN car_catalog cc ON uc.catalog_id = cc.id
            ORDER BY u.wins DESC, u.level DESC 
            LIMIT 10
        `);
        res.json(topUsers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DragX сървърът работи на порт ${PORT}`);
});