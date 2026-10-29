const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');
const backendDir = path.join(rootDir, 'backend');
const frontendDist = path.join(frontendDir, 'dist');
const backendDist = path.join(backendDir, 'dist');

console.log('=== Starting Build and Distribution Process ===');

// 1. Run the build in the frontend directory
console.log('\nStep 1: Building frontend...');
try {
  execSync('npm run build:web', {
    cwd: frontendDir,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' }
  });
} catch (error) {
  console.error('Error during frontend build:', error.message);
  process.exit(1);
}

// 2. Clean backend dist directory
console.log('\nStep 2: Cleaning backend/dist directory...');
try {
  if (fs.existsSync(backendDist)) {
    fs.rmSync(backendDist, { recursive: true, force: true });
    console.log('Cleaned backend/dist successfully.');
  }
} catch (error) {
  console.error('Error cleaning backend/dist:', error.message);
  process.exit(1);
}

// 3. Copy frontend dist to backend dist
console.log('\nStep 3: Copying frontend/dist to backend/dist...');
try {
  fs.mkdirSync(backendDist, { recursive: true });
  fs.cpSync(frontendDist, backendDist, { recursive: true, force: true });
  console.log('Copied frontend build to backend/dist successfully!');
} catch (error) {
  console.error('Error copying files:', error.message);
  process.exit(1);
}

console.log('\n=== Build & Dist process completed successfully! ===\n');
