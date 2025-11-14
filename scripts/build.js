const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const esbuild = require('esbuild');

const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const args = process.argv.slice(2);
const watchMode = args.includes('--watch');

const staticFiles = [
  'index.html'
  // Note: app.js is now bundled from src/index.js via esbuild
  // button-types.json and toddler-content.json are in public/config/
  // and are copied via copyDirectory('public', distDir) below
];

const vendorFiles = [
  { src: 'node_modules/canvas-confetti/dist/confetti.browser.js', dest: 'vendor/confetti.js' }
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(relativePath, destinationRoot) {
  const srcPath = path.join(projectRoot, relativePath);
  const destPath = path.join(destinationRoot, relativePath);

  if (!fs.existsSync(srcPath)) {
    console.warn(`Skipping missing file: ${relativePath}`);
    return;
  }

  ensureDir(path.dirname(destPath));
  fs.copyFileSync(srcPath, destPath);
}

function copyDirectory(relativePath, destinationRoot) {
  const srcDir = path.join(projectRoot, relativePath);
  const destDir = path.join(destinationRoot, relativePath);

  if (!fs.existsSync(srcDir)) {
    return;
  }

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  ensureDir(destDir);

  for (const entry of entries) {
    const entryRelPath = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(entryRelPath, destinationRoot);
    } else {
      copyFile(entryRelPath, destinationRoot);
    }
  }
}

function copyDirectoryContents(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) {
    return;
  }

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  ensureDir(destDir);

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryContents(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function cleanDist() {
  fs.rmSync(distDir, { recursive: true, force: true });
  ensureDir(distDir);
}

function buildTailwind() {
  const input = path.join(projectRoot, 'styles', 'tailwind.css');
  const output = path.join(distDir, 'tailwind.css');

  if (!fs.existsSync(input)) {
    console.warn('Skipping Tailwind build: input file not found.');
    return;
  }

  let tailwindCli;
  try {
    tailwindCli = require.resolve('tailwindcss/lib/cli.js');
  } catch (error) {
    throw new Error('Tailwind CSS CLI not found. Run "npm install" before building.');
  }

  const result = spawnSync(process.execPath, [tailwindCli, '-i', input, '-o', output, '--minify'], {
    cwd: projectRoot,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error('Tailwind build failed');
  }
}

async function buildJavaScript() {
  const entryPoint = path.join(projectRoot, 'src', 'index.js');
  const outfile = path.join(distDir, 'app.js');

  if (!fs.existsSync(entryPoint)) {
    throw new Error('Entry point not found: src/index.js');
  }

  try {
    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile: outfile,
      format: 'iife',
      platform: 'browser',
      target: ['es2020'],
      minify: !watchMode,
      sourcemap: watchMode,
      logLevel: 'info',
    });
    console.log(`Bundled JavaScript: ${path.relative(projectRoot, outfile)}`);
  } catch (error) {
    throw new Error(`JavaScript bundling failed: ${error.message}`);
  }
}

async function build() {
  cleanDist();
  buildTailwind();
  await buildJavaScript();
  staticFiles.forEach(file => copyFile(file, distDir));

  // Copy vendor files
  vendorFiles.forEach(({ src, dest }) => {
    const srcPath = path.join(projectRoot, src);
    const destPath = path.join(distDir, dest);

    if (fs.existsSync(srcPath)) {
      ensureDir(path.dirname(destPath));
      fs.copyFileSync(srcPath, destPath);
      console.log(`Copied vendor file: ${dest}`);
    } else {
      console.warn(`Vendor file not found: ${src}`);
    }
  });

  // Copy contents of public directory to dist (not the directory itself)
  const publicDir = path.join(projectRoot, 'public');
  copyDirectoryContents(publicDir, distDir);
  console.log(`Build complete. Assets copied to ${distDir}`);
}

const watchers = [];
const watchedDirectories = new Set();
let buildInProgress = false;
let pendingBuild = false;
let pendingReason = null;
let debounceTimer = null;

async function triggerBuild(reason = 'file change') {
  if (buildInProgress) {
    pendingBuild = true;
    pendingReason = reason;
    return;
  }

  buildInProgress = true;
  const start = Date.now();
  const label = reason || 'file change';
  console.log(`Starting build (${label})...`);

  try {
    await build();
    const duration = Date.now() - start;
    console.log(`Build finished (${label}) in ${duration}ms`);
  } catch (error) {
    console.error('Build failed:', error);
  } finally {
    buildInProgress = false;
    if (pendingBuild) {
      const queuedReason = pendingReason;
      pendingBuild = false;
      pendingReason = null;
      await triggerBuild(queuedReason);
    }
  }
}

function scheduleRebuild(reason) {
  if (debounceTimer) {
    pendingReason = reason || pendingReason;
    return;
  }

  pendingReason = reason;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const reasonToUse = pendingReason || 'file change';
    pendingReason = null;
    triggerBuild(reasonToUse);
  }, 100);
}

function handleWatchEvent(eventPath) {
  const relativePath = eventPath ? path.relative(projectRoot, eventPath) : 'unknown path';
  scheduleRebuild(relativePath);
}

function watchFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Watch skipped missing file: ${path.relative(projectRoot, filePath)}`);
    return;
  }

  const watcher = fs.watch(filePath, () => handleWatchEvent(filePath));
  watchers.push(watcher);
  console.log(`Watching file: ${path.relative(projectRoot, filePath)}`);
}

function watchDirectoryRecursive(dirPath) {
  if (watchedDirectories.has(dirPath)) {
    return;
  }

  watchedDirectories.add(dirPath);

  let watcher;
  try {
    watcher = fs.watch(dirPath, { recursive: true }, (_, filename) => {
      const watchedPath = filename ? path.join(dirPath, filename.toString()) : dirPath;
      handleWatchEvent(watchedPath);

      if (filename) {
        const candidatePath = path.join(dirPath, filename.toString());
        if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
          watchDirectoryRecursive(candidatePath);
        }
      }
    });
    console.log(`Watching directory (recursive): ${path.relative(projectRoot, dirPath)}`);
  } catch (error) {
    if (error.code !== 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
      throw error;
    }

    watcher = fs.watch(dirPath, (_, filename) => {
      const watchedPath = filename ? path.join(dirPath, filename.toString()) : dirPath;
      handleWatchEvent(watchedPath);

      if (filename) {
        const candidatePath = path.join(dirPath, filename.toString());
        if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
          watchDirectoryRecursive(candidatePath);
        }
      }
    });
    console.log(`Watching directory: ${path.relative(projectRoot, dirPath)}`);

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    entries
      .filter(entry => entry.isDirectory())
      .forEach(entry => watchDirectoryRecursive(path.join(dirPath, entry.name)));
  }

  watchers.push(watcher);
}

function setupWatchers() {
  staticFiles.forEach(file => watchFile(path.join(projectRoot, file)));

  const directoryWatchTargets = [
    path.join(projectRoot, 'src'),      // Watch src/ for modular code changes
    path.join(projectRoot, 'styles'),
    path.join(projectRoot, 'public')
  ];

  directoryWatchTargets.forEach(dirPath => {
    if (fs.existsSync(dirPath)) {
      watchDirectoryRecursive(dirPath);
    }
  });

  console.log('Watching for changes. Press Ctrl+C to stop.');
}

process.on('SIGINT', () => {
  console.log('\nStopping watcher...');
  watchers.forEach(watcher => watcher.close());
  process.exit(0);
});

triggerBuild('initial build');

if (watchMode) {
  setupWatchers();
}
