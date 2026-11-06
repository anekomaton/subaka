import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, 'package.json');
const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
const releaseWorkflowPath = path.join(rootDir, '.github', 'workflows', 'release.yml');

try {
  if (!fs.existsSync(packageJsonPath)) {
    console.warn('[sync-version] package.json not found!');
    process.exit(0);
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const version = pkg.version;
  if (!version) {
    console.warn('[sync-version] No version found in package.json');
    process.exit(0);
  }

  console.log(`[sync-version] Propagating version "${version}" from package.json...`);

  // 1. Sync src-tauri/tauri.conf.json
  if (fs.existsSync(tauriConfPath)) {
    try {
      const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
      let changed = false;
      if (tauriConf.version !== version) {
        tauriConf.version = version;
        changed = true;
      }
      if (tauriConf.app?.windows?.[0]) {
        const expectedTitle = `SUBaka ${version}`;
        if (tauriConf.app.windows[0].title !== expectedTitle) {
          tauriConf.app.windows[0].title = expectedTitle;
          changed = true;
        }
      }
      if (changed) {
        fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf8');
        console.log(`[sync-version] Updated src-tauri/tauri.conf.json -> version ${version}`);
      }
    } catch (err) {
      console.warn('[sync-version] Could not sync tauri.conf.json:', err?.message || err);
    }
  }

  // 2. Sync src-tauri/Cargo.toml
  if (fs.existsSync(cargoTomlPath)) {
    try {
      const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
      const newCargoToml = cargoToml.replace(
        /^(\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m,
        `$1"${version}"`
      );
      if (newCargoToml !== cargoToml) {
        fs.writeFileSync(cargoTomlPath, newCargoToml, 'utf8');
        console.log(`[sync-version] Updated src-tauri/Cargo.toml -> version ${version}`);
      }
    } catch (err) {
      console.warn('[sync-version] Could not sync Cargo.toml:', err?.message || err);
    }
  }

  // 3. Sync .github/workflows/release.yml
  if (fs.existsSync(releaseWorkflowPath)) {
    try {
      const workflow = fs.readFileSync(releaseWorkflowPath, 'utf8');
      const updatedWorkflow = workflow
        .replace(/SUBaka_\d+\.\d+\.\d+_x64-setup/g, `SUBaka_${version}_x64-setup`)
        .replace(/tag_name:\s*\${{\s*startsWith\(github\.ref,\s*'refs\/tags\/'\)\s*&&\s*github\.ref_name\s*\|\|\s*'v\d+\.\d+\.\d+'\s*}}/g, `tag_name: \${{ startsWith(github.ref, 'refs/tags/') && github.ref_name || 'v${version}' }}`)
        .replace(/name:\s*'SUBaka v\d+\.\d+\.\d+ \(Windows x64\)'/g, `name: 'SUBaka v${version} (Windows x64)'`);

      if (updatedWorkflow !== workflow) {
        fs.writeFileSync(releaseWorkflowPath, updatedWorkflow, 'utf8');
        console.log(`[sync-version] Updated .github/workflows/release.yml -> version ${version}`);
      }
    } catch (err) {
      console.warn('[sync-version] Could not sync release.yml:', err?.message || err);
    }
  }

  console.log(`[sync-version] Version ${version} is synchronized across all project files.`);
} catch (err) {
  console.warn('[sync-version] Warning during version sync:', err?.message || err);
}
