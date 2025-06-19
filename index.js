const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PORT = 3000;

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'Superlook1!',
    database: 'todolist',
};

async function retrieveListItems() {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'SELECT id, text FROM items';
        const [rows] = await connection.execute(query);
        await connection.end();
        return rows;
    } catch (error) {
        console.error('Error retrieving list items:', error);
        throw error;
    }
}

async function getHtmlRows() {
    const todoItems = await retrieveListItems();
    return todoItems.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>
                <span id="text-${item.id}">${item.text}</span>
                <form id="form-${item.id}" style="display:none;" onsubmit="event.preventDefault();">
                    <input type="text" id="input-${item.id}" value="${item.text}" />
                    <button type="submit">Save</button>
                </form>
            </td>
            <td>
                <button onclick="document.getElementById('form-${item.id}').style.display='inline'; document.getElementById('text-${item.id}').style.display='none';">Edit</button>
                <form method="POST" action="/delete" style="display:inline;">
                    <input type="hidden" name="id" value="${item.id}" />
                    <button type="submit">Delete</button>
                </form>
            </td>
        </tr>
    `).join('');
}

async function handleRequest(req, res) {
    if (req.url === '/' && req.method === 'GET') {
        try {
            const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
            const processedHtml = html.replace('{{rows}}', await getHtmlRows());
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(processedHtml);
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading index.html');
        }

    } else if (req.method === 'POST' && req.url === '/add') {
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

    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Route not found');
    }
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
