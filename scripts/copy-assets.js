import fs from 'node:fs';
import path from 'node:path';

// Cross-platform helper to copy optional Grammardb parts to dist/ without shell dependency
try {
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }
  const files = fs.readdirSync('.');
  for (const file of files) {
    if (file.startsWith('grammardb.part.') || file === 'grammardb.sqlite3.gz') {
      const dest = path.join('dist', file);
      fs.copyFileSync(file, dest);
      console.log(`Copied ${file} -> dist/`);
    }
  }
} catch (err) {
  // Optional files, don't break build
}
