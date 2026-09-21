# Portfolio website with admin portal

## Run it
1. Install Node.js 18 or newer.
2. In this folder run: npm install
3. Copy .env.example to .env and set ADMIN_PASSWORD.
4. Run: npm start
5. Website: http://localhost:3000   Admin portal: http://localhost:3000/admin

## Admin portal
Log in with your ADMIN_PASSWORD, edit any tab, then click "Save changes".
- General: name, role, photo, accent colour, CV link, footer, social links
- About, Skills, Projects, Journey: add, edit, reorder, delete
- Images: upload pictures (JPG, PNG, WebP, GIF, max 6 MB) and reuse them
- Messages: messages sent through the contact form
- Security: change the admin password (do this on first login)

## Data
Everything you edit is stored in the data/ folder (content.json, messages, uploads/). Back it up.
To reset the text, delete data/content.json and restart.

## Deploying
Run with npm start behind nginx, keep it alive with systemd, add HTTPS with Let's Encrypt.
Set DATA_DIR to a persistent folder so uploads survive updates.
