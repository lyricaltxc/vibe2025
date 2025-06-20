const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const PORT = 3000;

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'Superlook1!',
    database: 'todolist',
};

// Простейшее хранилище сессий в памяти (id сессии -> userId)
const sessions = new Map();

// Помощник для парсинга cookie из заголовка
function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(cookie => {
        const [name, ...rest] = cookie.trim().split('=');
        cookies[name] = rest.join('=');
    });
    return cookies;
}

// Генерация случайного id сессии
function generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

// Шаблоны для блока аутентификации в html
const loginRegisterForms = `
<form method="POST" action="/login" style="display:inline-block;">
  <input type="text" name="username" placeholder="Username" required />
  <input type="password" name="password" placeholder="Password" required />
  <button type="submit">Login</button>
</form>

<form method="POST" action="/register" style="display:inline-block; margin-left: 20px;">
  <input type="text" name="username" placeholder="New username" required />
  <input type="password" name="password" placeholder="New password" required />
  <button type="submit">Register</button>
</form>
`;

function loggedInBlock(username) {
  return `
    <span>Привет, <b>${username}</b>!</span>
    <a href="/logout" style="margin-left:20px;">Выйти</a>
  `;
}

// Получение id пользователя из сессии
function getUserIdFromReq(req) {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies['sessionId'];
    if (!sessionId) return null;
    return sessions.get(sessionId) || null;
}

async function retrieveListItems(userId) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        // Для примера — показываем все задачи без фильтрации по пользователю,
        // можно добавить поле user_id в таблицу items и фильтровать по нему.
        const query = 'SELECT id, text FROM items';
        const [rows] = await connection.execute(query);
        await connection.end();
        return rows;
    } catch (error) {
        console.error('Error retrieving list items:', error);
        throw error;
    }
}

async function getHtmlRows(userId) {
    const todoItems = await retrieveListItems(userId);
    return todoItems.map((item, index) => 
        `<tr>
            <td>${index + 1}</td>
            <td>
                <span id="text-${item.id}">${item.text}</span>
                <form method="POST" action="/edit" id="form-${item.id}" style="display:none;">
                    <input type="hidden" name="id" value="${item.id}" />
                    <input type="text" name="text" value="${item.text}" />
                    <button type="submit">Save</button>
                </form>
            </td>
            <td>
                <button onclick="document.getElementById('form-${item.id}').style.display='inline'; document.getElementById('text-${item.id}').style.display='none'; this.style.display='none';">Edit</button>
                <form method="POST" action="/delete" style="display:inline;">
                    <input type="hidden" name="id" value="${item.id}" />
                    <button type="submit">Delete</button>
                </form>
            </td>
        </tr>`
    ).join('');
}

async function handleRequest(req, res) {
    const userId = getUserIdFromReq(req);

    if (req.url === '/' && req.method === 'GET') {
        try {
            const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');

            if (!userId) {
                // Пользователь не залогинен
                const page = html.replace('{{rows}}', '').replace('{{auth}}', loginRegisterForms);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                return res.end(page);
            }

            // Получаем имя пользователя из базы
            const connection = await mysql.createConnection(dbConfig);
            const [userRows] = await connection.execute('SELECT username FROM users WHERE id = ?', [userId]);
            await connection.end();

            const username = userRows[0]?.username || 'User';
            const rows = await getHtmlRows(userId);

            const page = html.replace('{{rows}}', rows).replace('{{auth}}', loggedInBlock(username));
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(page);

        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading index.html');
        }

    } else if (req.method === 'POST' && req.url === '/add') {
        if (!userId) {
            res.writeHead(403);
            return res.end('Forbidden');
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const parsed = new URLSearchParams(body);
            const text = parsed.get('text');

            try {
                const connection = await mysql.createConnection(dbConfig);
                await connection.execute('INSERT INTO items (text) VALUES (?)', [text]);
                await connection.end();
                res.writeHead(302, { Location: '/' });
                res.end();
            } catch (err) {
                console.error('Error inserting item:', err);
                res.writeHead(500);
                res.end('Internal Server Error');
            }
        });

    } else if (req.method === 'POST' && req.url === '/delete') {
        if (!userId) {
            res.writeHead(403);
            return res.end('Forbidden');
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const parsed = new URLSearchParams(body);
            const id = parsed.get('id');

            try {
                const connection = await mysql.createConnection(dbConfig);
                await connection.execute('DELETE FROM items WHERE id = ?', [id]);
                await connection.end();
                res.writeHead(302, { Location: '/' });
                res.end();
            } catch (err) {
                console.error('Error deleting item:', err);
                res.writeHead(500);
                res.end('Internal Server Error');
            }
        });

    } else if (req.method === 'POST' && req.url === '/edit') {
        if (!userId) {
            res.writeHead(403);
            return res.end('Forbidden');
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const parsed = new URLSearchParams(body);
            const id = parsed.get('id');
            const text = parsed.get('text');

            try {
                const connection = await mysql.createConnection(dbConfig);
                await connection.execute('UPDATE items SET text = ? WHERE id = ?', [text, id]);
                await connection.end();
                res.writeHead(302, { Location: '/' });
                res.end();
            } catch (err) {
                console.error('Error updating item:', err);
                res.writeHead(500);
                res.end('Internal Server Error');
            }
        });

    // Регистрация нового пользователя
    } else if (req.method === 'POST' && req.url === '/register') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const parsed = new URLSearchParams(body);
                const username = parsed.get('username');
                const password = parsed.get('password');

                if (!username || !password) {
                    res.writeHead(400);
                    return res.end('Missing username or password');
                }

                // Хешируем пароль для безопасности (используем sha256 для примера)
                const hash = crypto.createHash('sha256').update(password).digest('hex');

                const connection = await mysql.createConnection(dbConfig);
                await connection.execute(
                    'INSERT INTO users (username, password) VALUES (?, ?)',
                    [username, hash]
                );
                await connection.end();

                // После регистрации — редирект на главную (с предложением залогиниться)
                res.writeHead(302, { Location: '/' });
                res.end();

            } catch (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    res.writeHead(409);
                    return res.end('Username already exists');
                }
                console.error('Registration error:', err);
                res.writeHead(500);
                res.end('Internal Server Error');
            }
        });

    // Логин пользователя
    } else if (req.method === 'POST' && req.url === '/login') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const parsed = new URLSearchParams(body);
                const username = parsed.get('username');
                const password = parsed.get('password');

                if (!username || !password) {
                    res.writeHead(400);
                    return res.end('Missing username or password');
                }

                const hash = crypto.createHash('sha256').update(password).digest('hex');

                const connection = await mysql.createConnection(dbConfig);
                const [rows] = await connection.execute(
                    'SELECT id, password FROM users WHERE username = ?',
                    [username]
                );
                await connection.end();

                if (rows.length === 0) {
                    res.writeHead(401);
                    return res.end('Invalid username or password');
                }

                if (rows[0].password !== hash) {
                    res.writeHead(401);
                    return res.end('Invalid username or password');
                }

                // Логин успешен — создаём сессию
                const sessionId = generateSessionId();
                sessions.set(sessionId, rows[0].id);

                res.writeHead(302, {
                    'Set-Cookie': `sessionId=${sessionId}; HttpOnly; Path=/`,
                    Location: '/',
                });
                res.end();

            } catch (err) {
                console.error('Login error:', err);
                res.writeHead(500);
                res.end('Internal Server Error');
            }
        });

    // Логаут — удаляем сессию
    } else if (req.method === 'GET' && req.url === '/logout') {
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies['sessionId'];
        if (sessionId) sessions.delete(sessionId);

        res.writeHead(302, {
            'Set-Cookie': `sessionId=deleted; HttpOnly; Path=/; Max-Age=0`,
            Location: '/',
        });
        res.end();

    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Route not found');
    }
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
