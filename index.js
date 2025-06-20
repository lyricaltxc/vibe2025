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

// Простая сессия в памяти (для демонстрации)
const sessions = {};

function generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

async function retrieveListItems(userId) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'SELECT id, text FROM items WHERE user_id = ?';
        const [rows] = await connection.execute(query, [userId]);
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

async function getAuthHtml(isLoggedIn, username) {
    if (isLoggedIn) {
        return `
        <div style="text-align:center; margin-bottom: 20px;">
            Logged in as <strong>${username}</strong> | 
            <form method="POST" action="/logout" style="display:inline;">
                <button type="submit">Logout</button>
            </form>
        </div>
        `;
    } else {
        return `
        <form method="POST" action="/login" style="text-align:center; margin-bottom: 10px;">
            <input type="text" name="username" placeholder="Username" required />
            <input type="password" name="password" placeholder="Password" required />
            <button type="submit">Login</button>
        </form>
        <form method="POST" action="/register" style="text-align:center; margin-bottom: 20px;">
            <input type="text" name="username" placeholder="Username" required />
            <input type="password" name="password" placeholder="Password" required />
            <button type="submit">Register</button>
        </form>
        `;
    }
}

async function parseBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => resolve(new URLSearchParams(body)));
    });
}

async function handleRequest(req, res) {
    // Получаем сессионный id из cookies
    let cookies = {};
    if (req.headers.cookie) {
        req.headers.cookie.split(';').forEach(c => {
            const [key, value] = c.trim().split('=');
            cookies[key] = value;
        });
    }
    const sessionId = cookies.sessionId;
    const session = sessions[sessionId];
    const userId = session ? session.userId : null;
    const username = session ? session.username : null;

    if (req.url === '/' && req.method === 'GET') {
        try {
            const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
            const rows = userId ? await getHtmlRows(userId) : '';
            const authSection = await getAuthHtml(!!userId, username);
            const processedHtml = html
                .replace('{{rows}}', rows)
                .replace('{{auth}}', authSection);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(processedHtml);
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading index.html');
        }

    } else if (req.method === 'POST' && req.url === '/register') {
        const parsed = await parseBody(req);
        const regUsername = parsed.get('username');
        const regPassword = parsed.get('password');

        if (!regUsername || !regPassword) {
            res.writeHead(400);
            return res.end('Username and password required');
        }

        try {
            const connection = await mysql.createConnection(dbConfig);
            // Проверка на существование
            const [rows] = await connection.execute('SELECT id FROM users WHERE username = ?', [regUsername]);
            if (rows.length > 0) {
                await connection.end();
                res.writeHead(400);
                return res.end('Username already exists');
            }
            const hashed = hashPassword(regPassword);
            await connection.execute('INSERT INTO users (username, password) VALUES (?, ?)', [regUsername, hashed]);
            await connection.end();
            res.writeHead(302, { Location: '/' });
            res.end();
        } catch (err) {
            console.error('Registration error:', err);
            res.writeHead(500);
            res.end('Internal Server Error');
        }

    } else if (req.method === 'POST' && req.url === '/login') {
        const parsed = await parseBody(req);
        const loginUsername = parsed.get('username');
        const loginPassword = parsed.get('password');

        try {
            const connection = await mysql.createConnection(dbConfig);
            const [rows] = await connection.execute('SELECT id, password FROM users WHERE username = ?', [loginUsername]);
            await connection.end();

            if (rows.length === 0) {
                res.writeHead(401);
                return res.end('Invalid username or password');
            }

            const user = rows[0];
            if (hashPassword(loginPassword) !== user.password) {
                res.writeHead(401);
                return res.end('Invalid username or password');
            }

            // Успешный логин
            const newSessionId = generateSessionId();
            sessions[newSessionId] = { userId: user.id, username: loginUsername };
            res.writeHead(302, {
                Location: '/',
                'Set-Cookie': `sessionId=${newSessionId}; HttpOnly; Path=/`
            });
            res.end();

        } catch (err) {
            console.error('Login error:', err);
            res.writeHead(500);
            res.end('Internal Server Error');
        }

    } else if (req.method === 'POST' && req.url === '/logout') {
        if (sessionId && sessions[sessionId]) {
            delete sessions[sessionId];
        }
        res.writeHead(302, {
            Location: '/',
            'Set-Cookie': 'sessionId=deleted; Max-Age=0; Path=/'
        });
        res.end();

    } else if (!userId) {
        // Все остальные POST запросы требуют авторизации
        res.writeHead(403);
        res.end('Forbidden');

    } else if (req.method === 'POST' && req.url === '/add') {
        const parsed = await parseBody(req);
        const text = parsed.get('text');

        try {
            const connection = await mysql.createConnection(dbConfig);
            await connection.execute('INSERT INTO items (text, user_id) VALUES (?, ?)', [text, userId]);
            await connection.end();
            res.writeHead(302, { Location: '/' });
            res.end();
        } catch (err) {
            console.error('Error inserting item:', err);
            res.writeHead(500);
            res.end('Internal Server Error');
        }

    } else if (req.method === 'POST' && req.url === '/delete') {
        const parsed = await parseBody(req);
        const id = parsed.get('id');

        try {
            const connection = await mysql.createConnection(dbConfig);
            await connection.execute('DELETE FROM items WHERE id = ? AND user_id = ?', [id, userId]);
            await connection.end();
            res.writeHead(302, { Location: '/' });
            res.end();
        } catch (err) {
            console.error('Error deleting item:', err);
            res.writeHead(500);
            res.end('Internal Server Error');
        }

    } else if (req.method === 'POST' && req.url === '/edit') {
        const parsed = await parseBody(req);
        const id = parsed.get('id');
        const text = parsed.get('text');

        try {
            const connection = await mysql.createConnection(dbConfig);
            await connection.execute('UPDATE items SET text = ? WHERE id = ? AND user_id = ?', [text, id, userId]);
            await connection.end();
            res.writeHead(302, { Location: '/' });
            res.end();
        } catch (err) {
            console.error('Error updating item:', err);
            res.writeHead(500);
            res.end('Internal Server Error');
        }

    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Route not found');
    }
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
