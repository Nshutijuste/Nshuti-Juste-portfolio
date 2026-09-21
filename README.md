# Portfolio website with admin portal

Works on: Vercel (free), Netlify (free), or any Node host (Render, Railway, VPS).
Admin portal: /admin/   (edit text, projects, skills, upload images, read messages, change password)

## Run locally
1. Install Node.js 18+
2. npm install
3. Copy .env.example to .env and set ADMIN_PASSWORD
4. npm start  ->  http://localhost:3000  and  http://localhost:3000/admin/
Local data is saved in the data/ folder.

## Deploy on Vercel (free)
1. Push this folder to GitHub (do NOT commit node_modules or .env).
2. Vercel > Add New Project > import the repo. Leave build settings empty.
3. Project > Storage > Create > Blob > choose PUBLIC > connect to the project.
4. Settings > Environment Variables: add ADMIN_PASSWORD (and optionally SESSION_SECRET = any long random text).
5. Redeploy. Open yourdomain/admin/ and log in.

## Deploy on Netlify (free)
1. Push this folder to GitHub.
2. Netlify > Add new site > Import from Git. Build command: leave empty. Publish directory: public (already set in netlify.toml).
3. Site configuration > Environment variables: add ADMIN_PASSWORD (and optionally SESSION_SECRET).
4. Deploy. Open yoursite/admin/ and log in. Data and images are stored in Netlify Blobs automatically.
   If saving fails with a Blobs error, also add BLOBS_SITE_ID (Site configuration > Site ID) and BLOBS_TOKEN (a Netlify personal access token).

## Notes
- Image uploads are limited to 4 MB (serverless request limit).
- Change the admin password in Admin > Security after the first login.
- Contact form messages appear in Admin > Messages (they are not emailed).
