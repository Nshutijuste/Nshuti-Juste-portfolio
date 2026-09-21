'use strict';
const app = require('./backend/app');
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`\n  Portfolio:    http://localhost:${PORT}`);
  console.log(`  Admin portal: http://localhost:${PORT}/admin/\n`);
  if (!process.env.ADMIN_PASSWORD) console.warn('  ADMIN_PASSWORD is not set. The default password is in use; change it in Admin > Security.\n');
});
